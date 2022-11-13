import * as AWS from 'aws-sdk';
import {Context, EventBridgeEvent} from 'aws-lambda';
import mockedEnv, {RestoreFn} from 'mocked-env';

const mockedDescribeNetworkInterfaces = jest.fn();
const listTagsForResource = jest.fn();
const mockedChangeResourceRecordSets = jest.fn();

jest.mock('aws-sdk', () => ({
    EC2: jest.fn(() => ({
        describeNetworkInterfaces: mockedDescribeNetworkInterfaces
    })),
    ECS: jest.fn(() => ({
        listTagsForResource
    })),
    Route53: jest.fn(() => ({
        changeResourceRecordSets: mockedChangeResourceRecordSets
    }))
}));

jest.mock('aws-xray-sdk', () => ({
    captureAWSv3Client: <T>(client: T) => client
}));

// eslint-disable-next-line init-declarations
let restore: RestoreFn | undefined;

afterEach(() => {
    if (restore) {
        restore();
    }
});

const testEvent: EventBridgeEvent<'ECS Task State Change', AWS.ECS.Task> = {
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

test('Function updates Route 53 ', async () => {
    restore = mockedEnv({
        HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
        HOSTED_ZONE_NAME: 'example.com'
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
    const lambda = require('../lib/ecs-public-discovery.function');

    listTagsForResource.mockReturnValue({
        promise: () => Promise.resolve({
            tags: [
                {
                    key: '',
                    value: ''
                }
            ]
        })
    });

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
    mockedChangeResourceRecordSets.mockReturnValue({
        promise: () => Promise.resolve()
    });

    await lambda.handler(testEvent, null as unknown as Context, jest.fn());

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