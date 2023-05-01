/* eslint-disable no-console,no-process-env */
import * as AWSXRay from 'aws-xray-sdk-core';
import {EC2, NetworkInterface, Tag} from '@aws-sdk/client-ec2';
import {ResourceRecordSet, Route53} from '@aws-sdk/client-route-53';
import {EventBridgeHandler} from 'aws-lambda';
import {Task} from '@aws-sdk/client-ecs';

const ec2Client = AWSXRay.captureAWSv3Client(new EC2({}));
const route53Client = AWSXRay.captureAWSv3Client(new Route53({}));

const DEFAULT_TTL = 60;

const hostedZoneId = process.env.HOSTED_ZONE_ID;

if (!hostedZoneId) {
    throw new Error('HOSTED_ZONE_ID environment variable is not set!');
}

const hostedZoneName = process.env.HOSTED_ZONE_NAME;

if (!hostedZoneName) {
    throw new Error('HOSTED_ZONE_NAME environment variable is not set!');
}

const getNetworkInterfaceForTask = async (task: Task, taskId: string): Promise<NetworkInterface> => {
    const networkInterfaceId = task.attachments
        ?.find(attachment => attachment.type === 'eni')?.details
        ?.find(details => details.name === 'networkInterfaceId')?.value;

    if (!networkInterfaceId) {
        throw new Error(`Task ${taskId} does not have a network interface.`);
    }
    const networkInterfacesResponse = await ec2Client.describeNetworkInterfaces({
        NetworkInterfaceIds: [networkInterfaceId]
    });

    if (!networkInterfacesResponse.NetworkInterfaces) {
        throw new Error('DescribeNetworkInterfaces did not return any network interfaces!');
    }

    // eslint-disable-next-line no-magic-numbers
    return networkInterfacesResponse.NetworkInterfaces[0];
};

const getTag = (key: string, tags?: Tag[]): string | undefined => tags?.find(tag => tag.Key === key)?.Value;

const getRequiredTag = (key: string, error: string, tags?: Tag[]): string => {
    const tag = getTag(key, tags);

    if (!tag) {
        throw new Error(error);
    }

    return tag;
};

const handleTaskRunning = async (taskId: string, networkInterface: NetworkInterface) => {
    const nameTag = getRequiredTag(
        'public-discovery:name',
        `Task ${taskId} does not have the 'public-discovery:name' tag.`,
        networkInterface.TagSet
    );
    const name = `${nameTag}.${hostedZoneName}`;
    const publicIp = networkInterface.Association?.PublicIp;

    if (!publicIp) {
        throw new Error(`Task ${taskId} does not have a public ip address.`);
    }

    const ttlTag = getTag('public-discovery:ttl', networkInterface.TagSet);
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
    });
};

const getResourceRecordSetByIdentifier = async (
    setIdentifier: string,
    startRecordIdentifier?: string,
    startRecordName?: string,
    startRecordType?: string
// eslint-disable-next-line max-params
): Promise<ResourceRecordSet | undefined> => {
    // eslint-disable-next-line no-warning-comments
    // TODO: replace with paginate when added to AWS SDK
    const resourceRecordSetsResponse = await route53Client.listResourceRecordSets({
        HostedZoneId: hostedZoneId,
        StartRecordIdentifier: startRecordIdentifier,
        StartRecordName: startRecordName,
        StartRecordType: startRecordType
    });

    const resourceRecordSet = resourceRecordSetsResponse.ResourceRecordSets?.find(rrs => rrs.MultiValueAnswer &&
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
    });
};

export const handler: EventBridgeHandler<'ECS Task State Change', Task, void> = async event => {
    const {taskArn} = event.detail;

    if (!taskArn) {
        throw new Error('Unknown task ARN!');
    }

    // eslint-disable-next-line no-magic-numbers
    const taskId = taskArn.substring(taskArn.lastIndexOf('/') + 1);

    if (event.detail.desiredStatus === 'RUNNING') {
        const networkInterface = await getNetworkInterfaceForTask(event.detail, taskId);

        await handleTaskRunning(taskId, networkInterface);
    } else {
        await handleTaskStopped(taskId);
    }
};
