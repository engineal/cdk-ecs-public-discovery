/* eslint-disable no-console,no-process-env */
import * as AWS from 'aws-sdk';
import * as AWSXRay from 'aws-xray-sdk';
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

const getPublicIpForTask = async (task: AWS.ECS.Task): Promise<string> => {
    const networkInterfaceId = task.attachments
        ?.find(attachment => attachment.type === 'eni')?.details
        ?.find(details => details.name === 'networkInterfaceId')?.value;

    if (!networkInterfaceId) {
        throw new Error(`${task.taskArn} does not have a network interface.`);
    }
    const networkInterfacesResponse = await ec2Client.describeNetworkInterfaces({
        NetworkInterfaceIds: [networkInterfaceId]
    }).promise();
    // eslint-disable-next-line no-magic-numbers
    const publicIp = networkInterfacesResponse.NetworkInterfaces?.[0].Association?.PublicIp;

    if (!publicIp) {
        throw new Error(`${task.taskArn} does not have a public ip address.`);
    }

    return publicIp;
};

const getResourceRecordSetByIdentifier = async (setIdentifier: string): Promise<AWS.Route53.ResourceRecordSet | undefined> => {
    const predicate = (resourceRecordSet: AWS.Route53.ResourceRecordSet) => resourceRecordSet.MultiValueAnswer &&
        resourceRecordSet.Type === 'A' && resourceRecordSet.SetIdentifier === setIdentifier;

    let resourceRecordSetsResponse = await route53Client.listResourceRecordSets({
        HostedZoneId: hostedZoneId
    }).promise();

    let resourceRecordSet = resourceRecordSetsResponse.ResourceRecordSets.find(predicate);

    if (resourceRecordSet) {
        return resourceRecordSet;
    }

    while (resourceRecordSetsResponse.IsTruncated) {
        // eslint-disable-next-line no-await-in-loop
        resourceRecordSetsResponse = await route53Client.listResourceRecordSets({
            HostedZoneId: hostedZoneId,
            StartRecordIdentifier: resourceRecordSetsResponse.NextRecordIdentifier,
            StartRecordName: resourceRecordSetsResponse.NextRecordName,
            StartRecordType: resourceRecordSetsResponse.NextRecordType
        }).promise();

        resourceRecordSet = resourceRecordSetsResponse.ResourceRecordSets.find(predicate);

        if (resourceRecordSet) {
            return resourceRecordSet;
        }
    }

    return undefined;
};

export const handler: EventBridgeHandler<'ECS Task State Change', AWS.ECS.Task, void> = async event => {
    const {taskArn} = event.detail;

    if (!taskArn) {
        throw new Error('Unknown task ARN!');
    }

    // eslint-disable-next-line no-magic-numbers
    const setIdentifier = taskArn.substring(taskArn.lastIndexOf('/') + 1);

    if (event.detail.desiredStatus === 'RUNNING') {
        const tagsResponse = await ecsClient.listTagsForResource({
            resourceArn: taskArn
        }).promise();

        const nameTag = tagsResponse.tags?.find(tag => tag.key === 'public-discovery:name')?.value;

        if (!nameTag) {
            throw new Error(`${taskArn} does not have the 'public-discovery:name' tag.`);
        }
        const name = `${nameTag}.${hostedZoneName}`;
        const publicIp = await getPublicIpForTask(event.detail);
        const ttlTag = tagsResponse.tags?.find(tag => tag.key === 'public-discovery:ttl')?.value;
        const ttl = ttlTag ? Number(ttlTag) : DEFAULT_TTL;

        console.log(`UPSERT '${name}' with address '${publicIp}' for set '${setIdentifier}'.`);

        await route53Client.changeResourceRecordSets({
            ChangeBatch: {
                Changes: [{
                    Action: 'UPSERT',
                    ResourceRecordSet: {
                        MultiValueAnswer: true,
                        Name: name,
                        ResourceRecords: [{Value: publicIp}],
                        SetIdentifier: setIdentifier,
                        TTL: ttl,
                        Type: 'A'
                    }
                }]
            },
            HostedZoneId: hostedZoneId
        }).promise();
    } else {
        const resourceRecordSet = await getResourceRecordSetByIdentifier(setIdentifier);

        if (!resourceRecordSet) {
            console.log(`No resource record sets found with set identifier: '${setIdentifier}'.`);

            return;
        }

        // eslint-disable-next-line no-magic-numbers
        const publicIp = resourceRecordSet.ResourceRecords?.[0].Value;

        if (!publicIp) {
            throw new Error(`${taskArn} does not have a public ip address.`);
        }

        console.log(`DELETE '${resourceRecordSet.Name}' with address '${publicIp}' for set '${setIdentifier}'.`);

        await route53Client.changeResourceRecordSets({
            ChangeBatch: {
                Changes: [{
                    Action: 'DELETE',
                    ResourceRecordSet: {
                        MultiValueAnswer: true,
                        Name: resourceRecordSet.Name,
                        ResourceRecords: [{Value: publicIp}],
                        SetIdentifier: setIdentifier,
                        TTL: resourceRecordSet.TTL,
                        Type: 'A'
                    }
                }]
            },
            HostedZoneId: hostedZoneId
        }).promise();
    }
};
