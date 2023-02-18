/* eslint-disable no-console,no-process-env */
import * as AWS from 'aws-sdk';
import * as AWSXRay from 'aws-xray-sdk-core';
import {EventBridgeHandler} from 'aws-lambda';

const ec2Client = AWSXRay.captureAWSClient(new AWS.EC2());
const ecsClient = AWSXRay.captureAWSClient(new AWS.ECS());
const route53Client = AWSXRay.captureAWSClient(new AWS.Route53());

const DEFAULT_TTL = 60;

const hostedZoneId = process.env.HOSTED_ZONE_ID;

if (!hostedZoneId) {
    throw new Error('HOSTED_ZONE_ID environment variable is not set!');
}

const hostedZoneName = process.env.HOSTED_ZONE_NAME;

if (!hostedZoneName) {
    throw new Error('HOSTED_ZONE_NAME environment variable is not set!');
}

const getPublicIpForTask = async (task: AWS.ECS.Task, taskId: string): Promise<string> => {
    const networkInterfaceId = task.attachments
        ?.find(attachment => attachment.type === 'eni')?.details
        ?.find(details => details.name === 'networkInterfaceId')?.value;

    if (!networkInterfaceId) {
        throw new Error(`Task ${taskId} does not have a network interface.`);
    }
    const networkInterfacesResponse = await ec2Client.describeNetworkInterfaces({
        NetworkInterfaceIds: [networkInterfaceId]
    }).promise();
    // eslint-disable-next-line no-magic-numbers
    const publicIp = networkInterfacesResponse.NetworkInterfaces?.[0].Association?.PublicIp;

    if (!publicIp) {
        throw new Error(`Task ${taskId} does not have a public ip address.`);
    }

    return publicIp;
};

const handleTaskRunning = async (taskArn: string, taskId: string, publicIp: string) => {
    const tagsResponse = await ecsClient.listTagsForResource({
        resourceArn: taskArn
    }).promise();

    const nameTag = tagsResponse.tags?.find(tag => tag.key === 'public-discovery:name')?.value;

    if (!nameTag) {
        throw new Error(`Task ${taskId} does not have the 'public-discovery:name' tag.`);
    }
    const name = `${nameTag}.${hostedZoneName}`;
    const ttlTag = tagsResponse.tags?.find(tag => tag.key === 'public-discovery:ttl')?.value;
    const ttl = ttlTag ? Number(ttlTag) : DEFAULT_TTL;

    console.log(`UPSERT '${name}' with address '${publicIp}' for set '${taskId}'.`);

    await route53Client.changeResourceRecordSets({
        ChangeBatch: {
            Changes: [{
                Action: 'UPSERT',
                ResourceRecordSet: {
                    MultiValueAnswer: true,
                    Name: name,
                    ResourceRecords: [{Value: publicIp}],
                    SetIdentifier: taskId,
                    TTL: ttl,
                    Type: 'A'
                }
            }]
        },
        HostedZoneId: hostedZoneId
    }).promise();
};

const getResourceRecordSetByIdentifier = async (
    setIdentifier: string,
    startRecordIdentifier?: string,
    startRecordName?: string,
    startRecordType?: string
// eslint-disable-next-line max-params
): Promise<AWS.Route53.ResourceRecordSet | undefined> => {
    const resourceRecordSetsResponse = await route53Client.listResourceRecordSets({
        HostedZoneId: hostedZoneId,
        StartRecordIdentifier: startRecordIdentifier,
        StartRecordName: startRecordName,
        StartRecordType: startRecordType
    }).promise();

    const resourceRecordSet = resourceRecordSetsResponse.ResourceRecordSets.find(rrs => rrs.MultiValueAnswer &&
        rrs.Type === 'A' && rrs.SetIdentifier === setIdentifier);

    if (resourceRecordSet) {
        return resourceRecordSet;
    }

    if (resourceRecordSetsResponse.IsTruncated) {
        return getResourceRecordSetByIdentifier(
            setIdentifier,
            resourceRecordSetsResponse.NextRecordIdentifier,
            resourceRecordSetsResponse.NextRecordName,
            resourceRecordSetsResponse.NextRecordType
        );
    }

    // eslint-disable-next-line no-undefined
    return undefined;
};

const handleTaskStopped = async (taskId: string) => {
    const resourceRecordSet = await getResourceRecordSetByIdentifier(taskId);

    if (!resourceRecordSet?.ResourceRecords) {
        console.log(`No resource record sets found with set identifier: '${taskId}'.`);

        return;
    }

    // eslint-disable-next-line no-magic-numbers
    const publicIp = resourceRecordSet.ResourceRecords[0].Value;

    console.log(`DELETE '${resourceRecordSet.Name}' with address '${publicIp}' for set '${taskId}'.`);

    await route53Client.changeResourceRecordSets({
        ChangeBatch: {
            Changes: [{
                Action: 'DELETE',
                ResourceRecordSet: {
                    MultiValueAnswer: true,
                    Name: resourceRecordSet.Name,
                    ResourceRecords: [{Value: publicIp}],
                    SetIdentifier: taskId,
                    TTL: resourceRecordSet.TTL,
                    Type: 'A'
                }
            }]
        },
        HostedZoneId: hostedZoneId
    }).promise();
};

export const handler: EventBridgeHandler<'ECS Task State Change', AWS.ECS.Task, void> = async event => {
    const {taskArn} = event.detail;

    if (!taskArn) {
        throw new Error('Unknown task ARN!');
    }

    // eslint-disable-next-line no-magic-numbers
    const taskId = taskArn.substring(taskArn.lastIndexOf('/') + 1);

    if (event.detail.desiredStatus === 'RUNNING') {
        const publicIp = await getPublicIpForTask(event.detail, taskId);

        await handleTaskRunning(taskArn, taskId, publicIp);
    } else {
        await handleTaskStopped(taskId);
    }
};
