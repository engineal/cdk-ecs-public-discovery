import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import {EcsPublicDiscovery} from '../lib';
import {Template} from 'aws-cdk-lib/assertions';

test('Lambda function created', () => {
    const stack = new cdk.Stack();
    const taskDefinition = new ecs.FargateTaskDefinition(stack, 'TestTaskDefinition');

    taskDefinition.addContainer('TestContainer', {
        image: ecs.ContainerImage.fromRegistry('hello-world')
    });

    const cluster = new ecs.Cluster(stack, 'TestCluster');
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(stack, 'HostedZone', {
        hostedZoneId: 'Z1R8UBAEXAMPLE',
        zoneName: 'example.com'
    });

    // eslint-disable-next-line no-new
    new EcsPublicDiscovery(stack, 'EcsPublicDiscovery', {
        cluster,
        hostedZone
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
            Variables: {
                AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
                HOSTED_ZONE_ID: 'Z1R8UBAEXAMPLE',
                HOSTED_ZONE_NAME: 'example.com'
            }
        },
        Handler: 'index.handler',
        Role: {
            'Fn::GetAtt': ['EcsPublicDiscoveryfunctionServiceRole6B6A990F', 'Arn']
        },
        Runtime: 'nodejs14.x'
    });
});

// eslint-disable-next-line max-lines-per-function
test('Permissions granted', () => {
    const stack = new cdk.Stack();
    const taskDefinition = new ecs.FargateTaskDefinition(stack, 'TestTaskDefinition');

    taskDefinition.addContainer('TestContainer', {
        image: ecs.ContainerImage.fromRegistry('hello-world')
    });

    const cluster = new ecs.Cluster(stack, 'TestCluster');
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(stack, 'HostedZone', {
        hostedZoneId: 'Z1R8UBAEXAMPLE',
        zoneName: 'example.com'
    });

    // eslint-disable-next-line no-new
    new EcsPublicDiscovery(stack, 'EcsPublicDiscovery', {
        cluster,
        hostedZone
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
            Statement: [
                {
                    Action: 'ecs:ListTagsForResource',
                    Effect: 'Allow',
                    Resource: {
                        'Fn::Join': [
                            '',
                            [
                                'arn:',
                                {
                                    Ref: 'AWS::Partition'
                                },
                                ':ecs:',
                                {
                                    Ref: 'AWS::Region'
                                },
                                ':',
                                {
                                    Ref: 'AWS::AccountId'
                                },
                                ':task/',
                                {
                                    Ref: 'TestClusterE0095054'
                                },
                                '/*'
                            ]
                        ]
                    }
                },
                {
                    Action: 'ec2:DescribeNetworkInterfaces',
                    Effect: 'Allow',
                    Resource: '*'
                },
                {
                    Action: [
                        'route53:ListResourceRecordSets',
                        'route53:ChangeResourceRecordSets'
                    ],
                    Effect: 'Allow',
                    Resource: {
                        'Fn::Join': ['', ['arn:', {Ref: 'AWS::Partition'}, ':route53:::hostedzone/Z1R8UBAEXAMPLE']]
                    }
                }
            ],
            Version: '2012-10-17'
        },
        PolicyName: 'EcsPublicDiscoveryfunctionServiceRoleDefaultPolicyCC653CEF',
        Roles: [
            {Ref: 'EcsPublicDiscoveryfunctionServiceRole6B6A990F'}
        ]
    });
});

test('Rule created', () => {
    const stack = new cdk.Stack();
    const taskDefinition = new ecs.FargateTaskDefinition(stack, 'TestTaskDefinition');

    taskDefinition.addContainer('TestContainer', {
        image: ecs.ContainerImage.fromRegistry('hello-world')
    });

    const cluster = new ecs.Cluster(stack, 'TestCluster');
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(stack, 'HostedZone', {
        hostedZoneId: 'Z1R8UBAEXAMPLE',
        zoneName: 'example.com'
    });

    // eslint-disable-next-line no-new
    new EcsPublicDiscovery(stack, 'EcsPublicDiscovery', {
        cluster,
        hostedZone
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
            'detail': {
                clusterArn: [{'Fn::GetAtt': ['TestClusterE0095054', 'Arn']}],
                desiredStatus: ['RUNNING', 'STOPPED'],
                lastStatus: ['RUNNING']
            },
            'detail-type': ['ECS Task State Change'],
            'source': ['aws.ecs']
        },
        State: 'ENABLED',
        Targets: [
            {
                Arn: {'Fn::GetAtt': ['EcsPublicDiscoveryfunction23A3479F', 'Arn']},
                Id: 'Target0'
            }
        ]
    });

    template.hasResourceProperties('AWS::Lambda::Permission', {
        Action: 'lambda:InvokeFunction',
        FunctionName: {'Fn::GetAtt': ['EcsPublicDiscoveryfunction23A3479F', 'Arn']},
        Principal: 'events.amazonaws.com',
        SourceArn: {'Fn::GetAtt': ['EcsPublicDiscoveryRoute53UpdaterFunctionRuleE5C51ACF', 'Arn']}
    });
});

test('Tags added to service', () => {
    const stack = new cdk.Stack();
    const taskDefinition = new ecs.FargateTaskDefinition(stack, 'TestTaskDefinition');

    taskDefinition.addContainer('TestContainer', {
        image: ecs.ContainerImage.fromRegistry('hello-world')
    });

    const cluster = new ecs.Cluster(stack, 'TestCluster');
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(stack, 'HostedZone', {
        hostedZoneId: 'Z1R8UBAEXAMPLE',
        zoneName: 'example.com'
    });

    const ecsPublicDiscovery = new EcsPublicDiscovery(stack, 'EcsPublicDiscovery', {
        cluster,
        hostedZone
    });

    const service = new ecs.FargateService(stack, 'TestService', {
        assignPublicIp: true,
        cluster,
        taskDefinition
    });

    ecsPublicDiscovery.addService({
        // eslint-disable-next-line no-magic-numbers
        dnsTtl: cdk.Duration.minutes(1),
        name: 'test',
        service
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ECS::Service', {
        Tags: [
            {
                Key: 'public-discovery:name',
                Value: 'test'
            },
            {
                Key: 'public-discovery:ttl',
                Value: '60'
            }
        ]
    });
});
