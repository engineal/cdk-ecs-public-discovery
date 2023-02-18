/* eslint-disable max-lines */
import * as AWS from 'aws-sdk';
import {Context, EventBridgeEvent} from 'aws-lambda';
import mockedEnv, {RestoreFn} from 'mocked-env';

const mockedDescribeNetworkInterfaces = jest.fn();
const listTagsForResource = jest.fn();
const mockedListResourceRecordSets = jest.fn();
const mockedChangeResourceRecordSets = jest.fn();

jest.mock('aws-sdk', () => ({
    EC2: jest.fn(() => ({
        describeNetworkInterfaces: mockedDescribeNetworkInterfaces
    })),
    ECS: jest.fn(() => ({
        listTagsForResource
    })),
    Route53: jest.fn(() => ({
        changeResourceRecordSets: mockedChangeResourceRecordSets,
        listResourceRecordSets: mockedListResourceRecordSets
    }))
}));

jest.mock('aws-xray-sdk-core', () => ({
    captureAWSClient: <T>(client: T) => client
}));

// eslint-disable-next-line init-declarations
let restore: RestoreFn | undefined;

beforeEach(() => {
    jest.clearAllMocks();
});

afterEach(() => {
    if (restore) {
        restore();
    }
});

test('Error on missing HOSTED_ZONE_ID', () => {
    restore = mockedEnv({
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    expect(() => require('../lib/ecs-public-discovery.function'))
        .toThrow('HOSTED_ZONE_ID environment variable is not set!');
});

test('Error on missing HOSTED_ZONE_NAME', () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    expect(() => require('../lib/ecs-public-discovery.function'))
        .toThrow('HOSTED_ZONE_NAME environment variable is not set!');
});

const testUnsupportedEvent: EventBridgeEvent<'ECS Task State Change', AWS.ECS.Task> = {
    'account': '111122223333',
    'detail': {},
    'detail-type': 'ECS Task State Change',
    'id': '28f04639-8265-b612-cd30-ecd479840c1a',
    'region': 'us-east-1',
    'resources': [
        'arn:aws:ecs:us-east-1:123456789012:task/TestCluster/9b67f8db50a44c2c87821ee0bb66b5a3'
    ],
    'source': 'aws.ecs',
    'time': '2020-11-06T21:46:40Z',
    'version': '0'
};

test('Error on unsupported event', async () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const lambda = require('../lib/ecs-public-discovery.function');

    await expect(lambda.handler(testUnsupportedEvent, null as unknown as Context, jest.fn())).rejects
        .toThrow('Unknown task ARN!');
});

const testRunningEvent: EventBridgeEvent<'ECS Task State Change', AWS.ECS.Task> = {
    'account': '111122223333',
    'detail': {
        attachments: [
            {
                details: [
                    {
                        name: 'subnetId',
                        value: 'subnet-abcd1234'
                    },
                    {
                        name: 'networkInterfaceId',
                        value: 'eni-abcd1234'
                    },
                    {
                        name: 'macAddress',
                        value: '0a:98:eb:a7:29:ba'
                    },
                    {
                        name: 'privateIPv4Address',
                        value: '10.0.0.139'
                    }
                ],
                id: '1789bcae-ddfb-4d10-8ebe-8ac87ddba5b8',
                status: 'ATTACHED',
                type: 'eni'
            }
        ],
        availabilityZone: 'us-west-2c',
        clusterArn: 'arn:aws:ecs:us-west-2:111122223333:cluster/FargateCluster',
        connectivity: 'CONNECTED',
        containers: [
            {
                containerArn: 'arn:aws:ecs:us-west-2:111122223333:container/cf159fd6-3e3f-4a9e-84f9-66cbe726af01',
                cpu: '0',
                image: '111122223333.dkr.ecr.us-west-2.amazonaws.com/hello-repository:latest',
                imageDigest: 'sha256:74b2c688c700ec95a93e478cdb959737c148df3fbf5ea706abe0318726e885e6',
                lastStatus: 'RUNNING',
                name: 'FargateApp',
                networkInterfaces: [
                    {
                        attachmentId: '1789bcae-ddfb-4d10-8ebe-8ac87ddba5b8',
                        privateIpv4Address: '10.0.0.139'
                    }
                ],
                runtimeId: 'ad64cbc71c7fb31c55507ec24c9f77947132b03d48d9961115cf24f3b7307e1e',
                taskArn: 'arn:aws:ecs:us-west-2:111122223333:task/FargateCluster/c13b4cb40f1f4fe4a2971f76ae5a47ad'
            }
        ],
        cpu: '256',
        desiredStatus: 'RUNNING',
        group: 'service:sample-fargate',
        lastStatus: 'RUNNING',
        launchType: 'FARGATE',
        memory: '512',
        overrides: {
            containerOverrides: [
                {
                    name: 'FargateApp'
                }
            ]
        },
        platformVersion: '1.4.0',
        startedBy: 'ecs-svc/8698694698746607723',
        taskArn: 'arn:aws:ecs:us-west-2:111122223333:task/FargateCluster/c13b4cb40f1f4fe4a2971f76ae5a47ad',
        taskDefinitionArn: 'arn:aws:ecs:us-west-2:111122223333:task-definition/sample-fargate:1',
        version: 4
    },
    'detail-type': 'ECS Task State Change',
    'id': '28f04639-8265-b612-cd30-ecd479840c1a',
    'region': 'us-east-1',
    'resources': [
        'arn:aws:ecs:us-east-1:123456789012:task/TestCluster/9b67f8db50a44c2c87821ee0bb66b5a3'
    ],
    'source': 'aws.ecs',
    'time': '2020-11-06T21:46:40Z',
    'version': '0'
};

// eslint-disable-next-line max-lines-per-function
test('Running event upserts record with default TTL', async () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const lambda = require('../lib/ecs-public-discovery.function');

    mockedDescribeNetworkInterfaces.mockReturnValue({
        promise: () => Promise.resolve({
            NetworkInterfaces: [
                {
                    Association: {
                        PublicIp: '1.2.3.4'
                    }
                }
            ]
        })
    });
    listTagsForResource.mockReturnValue({
        promise: () => Promise.resolve({
            tags: [
                {
                    key: 'public-discovery:name',
                    value: 'test'
                }
            ]
        })
    });
    mockedChangeResourceRecordSets.mockReturnValue({
        promise: () => Promise.resolve()
    });

    await lambda.handler(testRunningEvent, null as unknown as Context, jest.fn());

    expect(mockedChangeResourceRecordSets).toBeCalledWith({
        ChangeBatch: {
            Changes: [{
                Action: 'UPSERT',
                ResourceRecordSet: {
                    MultiValueAnswer: true,
                    Name: 'test.example.com',
                    ResourceRecords: [{Value: '1.2.3.4'}],
                    SetIdentifier: 'c13b4cb40f1f4fe4a2971f76ae5a47ad',
                    TTL: 60,
                    Type: 'A'
                }
            }]
        },
        HostedZoneId: 'Z1R8UBAEXAMPLE'
    });
});

// eslint-disable-next-line max-lines-per-function
test('Running event upserts record with custom TTL', async () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const lambda = require('../lib/ecs-public-discovery.function');

    mockedDescribeNetworkInterfaces.mockReturnValue({
        promise: () => Promise.resolve({
            NetworkInterfaces: [
                {
                    Association: {
                        PublicIp: '1.2.3.4'
                    }
                }
            ]
        })
    });
    listTagsForResource.mockReturnValue({
        promise: () => Promise.resolve({
            tags: [
                {
                    key: 'public-discovery:name',
                    value: 'test'
                },
                {
                    key: 'public-discovery:ttl',
                    value: '120'
                }
            ]
        })
    });
    mockedChangeResourceRecordSets.mockReturnValue({
        promise: () => Promise.resolve()
    });

    await lambda.handler(testRunningEvent, null as unknown as Context, jest.fn());

    expect(mockedChangeResourceRecordSets).toBeCalledWith({
        ChangeBatch: {
            Changes: [{
                Action: 'UPSERT',
                ResourceRecordSet: {
                    MultiValueAnswer: true,
                    Name: 'test.example.com',
                    ResourceRecords: [{Value: '1.2.3.4'}],
                    SetIdentifier: 'c13b4cb40f1f4fe4a2971f76ae5a47ad',
                    TTL: 120,
                    Type: 'A'
                }
            }]
        },
        HostedZoneId: 'Z1R8UBAEXAMPLE'
    });
});

const testRunningWithoutNetworkInterfaceEvent: EventBridgeEvent<'ECS Task State Change', AWS.ECS.Task> = {
    'account': '111122223333',
    'detail': {
        availabilityZone: 'us-west-2c',
        clusterArn: 'arn:aws:ecs:us-west-2:111122223333:cluster/FargateCluster',
        connectivity: 'CONNECTED',
        containers: [
            {
                containerArn: 'arn:aws:ecs:us-west-2:111122223333:container/cf159fd6-3e3f-4a9e-84f9-66cbe726af01',
                cpu: '0',
                image: '111122223333.dkr.ecr.us-west-2.amazonaws.com/hello-repository:latest',
                imageDigest: 'sha256:74b2c688c700ec95a93e478cdb959737c148df3fbf5ea706abe0318726e885e6',
                lastStatus: 'RUNNING',
                name: 'FargateApp',
                runtimeId: 'ad64cbc71c7fb31c55507ec24c9f77947132b03d48d9961115cf24f3b7307e1e',
                taskArn: 'arn:aws:ecs:us-west-2:111122223333:task/FargateCluster/c13b4cb40f1f4fe4a2971f76ae5a47ad'
            }
        ],
        cpu: '256',
        desiredStatus: 'RUNNING',
        group: 'service:sample-fargate',
        lastStatus: 'RUNNING',
        launchType: 'FARGATE',
        memory: '512',
        overrides: {
            containerOverrides: [
                {
                    name: 'FargateApp'
                }
            ]
        },
        platformVersion: '1.4.0',
        startedBy: 'ecs-svc/8698694698746607723',
        taskArn: 'arn:aws:ecs:us-west-2:111122223333:task/FargateCluster/c13b4cb40f1f4fe4a2971f76ae5a47ad',
        taskDefinitionArn: 'arn:aws:ecs:us-west-2:111122223333:task-definition/sample-fargate:1',
        version: 4
    },
    'detail-type': 'ECS Task State Change',
    'id': '28f04639-8265-b612-cd30-ecd479840c1a',
    'region': 'us-east-1',
    'resources': [
        'arn:aws:ecs:us-east-1:123456789012:task/TestCluster/9b67f8db50a44c2c87821ee0bb66b5a3'
    ],
    'source': 'aws.ecs',
    'time': '2020-11-06T21:46:40Z',
    'version': '0'
};

test('Error on running event without network interface', async () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const lambda = require('../lib/ecs-public-discovery.function');

    await expect(lambda.handler(testRunningWithoutNetworkInterfaceEvent, null as unknown as Context, jest.fn())).rejects
        .toThrow('Task c13b4cb40f1f4fe4a2971f76ae5a47ad does not have a network interface.');
});

test('Error on running event without public IP', async () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const lambda = require('../lib/ecs-public-discovery.function');

    mockedDescribeNetworkInterfaces.mockReturnValue({
        promise: () => Promise.resolve({
            NetworkInterfaces: [
                {}
            ]
        })
    });

    await expect(lambda.handler(testRunningEvent, null as unknown as Context, jest.fn())).rejects
        .toThrow('Task c13b4cb40f1f4fe4a2971f76ae5a47ad does not have a public ip address.');
});

test('Error on running event without name tag', async () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const lambda = require('../lib/ecs-public-discovery.function');

    mockedDescribeNetworkInterfaces.mockReturnValue({
        promise: () => Promise.resolve({
            NetworkInterfaces: [
                {
                    Association: {
                        PublicIp: '1.2.3.4'
                    }
                }
            ]
        })
    });
    listTagsForResource.mockReturnValue({
        promise: () => Promise.resolve({
            tags: []
        })
    });

    await expect(lambda.handler(testRunningEvent, null as unknown as Context, jest.fn())).rejects
        .toThrow('Task c13b4cb40f1f4fe4a2971f76ae5a47ad does not have the \'public-discovery:name\' tag.');
});

const testStoppedEvent: EventBridgeEvent<'ECS Task State Change', AWS.ECS.Task> = {
    'account': '111122223333',
    'detail': {
        attachments: [
            {
                details: [
                    {
                        name: 'subnetId',
                        value: 'subnet-abcd1234'
                    },
                    {
                        name: 'networkInterfaceId',
                        value: 'eni-abcd1234'
                    },
                    {
                        name: 'macAddress',
                        value: '0a:98:eb:a7:29:ba'
                    },
                    {
                        name: 'privateIPv4Address',
                        value: '10.0.0.139'
                    }
                ],
                id: '1789bcae-ddfb-4d10-8ebe-8ac87ddba5b8',
                status: 'ATTACHED',
                type: 'eni'
            }
        ],
        availabilityZone: 'us-west-2c',
        clusterArn: 'arn:aws:ecs:us-west-2:111122223333:cluster/FargateCluster',
        connectivity: 'CONNECTED',
        containers: [
            {
                containerArn: 'arn:aws:ecs:us-west-2:111122223333:container/cf159fd6-3e3f-4a9e-84f9-66cbe726af01',
                cpu: '0',
                image: '111122223333.dkr.ecr.us-west-2.amazonaws.com/hello-repository:latest',
                imageDigest: 'sha256:74b2c688c700ec95a93e478cdb959737c148df3fbf5ea706abe0318726e885e6',
                lastStatus: 'RUNNING',
                name: 'FargateApp',
                networkInterfaces: [
                    {
                        attachmentId: '1789bcae-ddfb-4d10-8ebe-8ac87ddba5b8',
                        privateIpv4Address: '10.0.0.139'
                    }
                ],
                runtimeId: 'ad64cbc71c7fb31c55507ec24c9f77947132b03d48d9961115cf24f3b7307e1e',
                taskArn: 'arn:aws:ecs:us-west-2:111122223333:task/FargateCluster/c13b4cb40f1f4fe4a2971f76ae5a47ad'
            }
        ],
        cpu: '256',
        desiredStatus: 'STOPPED',
        group: 'service:sample-fargate',
        lastStatus: 'RUNNING',
        launchType: 'FARGATE',
        memory: '512',
        overrides: {
            containerOverrides: [
                {
                    name: 'FargateApp'
                }
            ]
        },
        platformVersion: '1.4.0',
        startedBy: 'ecs-svc/8698694698746607723',
        taskArn: 'arn:aws:ecs:us-west-2:111122223333:task/FargateCluster/c13b4cb40f1f4fe4a2971f76ae5a47ad',
        taskDefinitionArn: 'arn:aws:ecs:us-west-2:111122223333:task-definition/sample-fargate:1',
        version: 4
    },
    'detail-type': 'ECS Task State Change',
    'id': '28f04639-8265-b612-cd30-ecd479840c1a',
    'region': 'us-east-1',
    'resources': [
        'arn:aws:ecs:us-east-1:123456789012:task/TestCluster/9b67f8db50a44c2c87821ee0bb66b5a3'
    ],
    'source': 'aws.ecs',
    'time': '2020-11-06T21:46:40Z',
    'version': '0'
};

test('Stopped event deletes record', async () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const lambda = require('../lib/ecs-public-discovery.function');

    mockedListResourceRecordSets.mockReturnValue({
        promise: () => Promise.resolve({
            IsTruncated: false,
            ResourceRecordSets: [
                {
                    MultiValueAnswer: true,
                    Name: 'test.example.com',
                    ResourceRecords: [{Value: '1.2.3.4'}],
                    SetIdentifier: 'c13b4cb40f1f4fe4a2971f76ae5a47ad',
                    TTL: 60,
                    Type: 'A'
                }
            ]
        })
    });

    mockedChangeResourceRecordSets.mockReturnValue({
        promise: () => Promise.resolve()
    });

    await lambda.handler(testStoppedEvent, null as unknown as Context, jest.fn());

    expect(mockedChangeResourceRecordSets).toBeCalledWith({
        ChangeBatch: {
            Changes: [{
                Action: 'DELETE',
                ResourceRecordSet: {
                    MultiValueAnswer: true,
                    Name: 'test.example.com',
                    ResourceRecords: [{Value: '1.2.3.4'}],
                    SetIdentifier: 'c13b4cb40f1f4fe4a2971f76ae5a47ad',
                    TTL: 60,
                    Type: 'A'
                }
            }]
        },
        HostedZoneId: 'Z1R8UBAEXAMPLE'
    });
});

// eslint-disable-next-line max-lines-per-function
test('Stopped event deletes 2nd record', async () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const lambda = require('../lib/ecs-public-discovery.function');

    mockedListResourceRecordSets.mockReturnValue({
        promise: () => Promise.resolve({
            IsTruncated: false,
            ResourceRecordSets: [
                {
                    MultiValueAnswer: true,
                    Name: 'test.example.com',
                    ResourceRecords: [{Value: '5.6.7.8'}],
                    SetIdentifier: '9256c379f1554f5f8b1d9546c164446e',
                    TTL: 60,
                    Type: 'A'
                },
                {
                    MultiValueAnswer: true,
                    Name: 'test.example.com',
                    ResourceRecords: [{Value: '1.2.3.4'}],
                    SetIdentifier: 'c13b4cb40f1f4fe4a2971f76ae5a47ad',
                    TTL: 60,
                    Type: 'A'
                }
            ]
        })
    });

    mockedChangeResourceRecordSets.mockReturnValue({
        promise: () => Promise.resolve()
    });

    await lambda.handler(testStoppedEvent, null as unknown as Context, jest.fn());

    expect(mockedChangeResourceRecordSets).toBeCalledWith({
        ChangeBatch: {
            Changes: [{
                Action: 'DELETE',
                ResourceRecordSet: {
                    MultiValueAnswer: true,
                    Name: 'test.example.com',
                    ResourceRecords: [{Value: '1.2.3.4'}],
                    SetIdentifier: 'c13b4cb40f1f4fe4a2971f76ae5a47ad',
                    TTL: 60,
                    Type: 'A'
                }
            }]
        },
        HostedZoneId: 'Z1R8UBAEXAMPLE'
    });
});

// eslint-disable-next-line max-lines-per-function
test('Stopped event deletes record on 2nd page', async () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const lambda = require('../lib/ecs-public-discovery.function');

    mockedListResourceRecordSets.mockReturnValueOnce({
        promise: () => Promise.resolve({
            IsTruncated: true,
            ResourceRecordSets: [
                {
                    MultiValueAnswer: true,
                    Name: 'test.example.com',
                    ResourceRecords: [{Value: '5.6.7.8'}],
                    SetIdentifier: '9256c379f1554f5f8b1d9546c164446e',
                    TTL: 60,
                    Type: 'A'
                }
            ]
        })
    }).mockReturnValueOnce({
        promise: () => Promise.resolve({
            IsTruncated: false,
            ResourceRecordSets: [
                {
                    MultiValueAnswer: true,
                    Name: 'test.example.com',
                    ResourceRecords: [{Value: '1.2.3.4'}],
                    SetIdentifier: 'c13b4cb40f1f4fe4a2971f76ae5a47ad',
                    TTL: 60,
                    Type: 'A'
                }
            ]
        })
    });

    mockedChangeResourceRecordSets.mockReturnValue({
        promise: () => Promise.resolve()
    });

    await lambda.handler(testStoppedEvent, null as unknown as Context, jest.fn());

    // eslint-disable-next-line no-magic-numbers
    expect(mockedListResourceRecordSets).toBeCalledTimes(2);

    expect(mockedChangeResourceRecordSets).toBeCalledWith({
        ChangeBatch: {
            Changes: [{
                Action: 'DELETE',
                ResourceRecordSet: {
                    MultiValueAnswer: true,
                    Name: 'test.example.com',
                    ResourceRecords: [{Value: '1.2.3.4'}],
                    SetIdentifier: 'c13b4cb40f1f4fe4a2971f76ae5a47ad',
                    TTL: 60,
                    Type: 'A'
                }
            }]
        },
        HostedZoneId: 'Z1R8UBAEXAMPLE'
    });
});

test('Stopped event without record', async () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const lambda = require('../lib/ecs-public-discovery.function');

    mockedListResourceRecordSets.mockReturnValue({
        promise: () => Promise.resolve({
            IsTruncated: false,
            ResourceRecordSets: []
        })
    });

    await lambda.handler(testStoppedEvent, null as unknown as Context, jest.fn());

    expect(mockedChangeResourceRecordSets).not.toBeCalled();
});
