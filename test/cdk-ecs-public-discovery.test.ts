import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import {EcsPublicDiscovery} from '../lib';
import {Template} from 'aws-cdk-lib/assertions';

test('Snapshot', () => {
    const stack = new cdk.Stack();
    const taskDefinition = new ecs.FargateTaskDefinition(stack, 'TestTaskDefinition');

    taskDefinition.addContainer('TestContainer', {
        image: ecs.ContainerImage.fromRegistry('hello-world')
    });

    const cluster = new ecs.Cluster(stack, 'TestCluster');
    const hostedZone = route53.HostedZone.fromHostedZoneId(stack, 'HostedZone', 'test-hosted-zone');

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
        name: 'name',
        service
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
            Variables: {
                AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
                HOSTED_ZONE_ID: 'test-hosted-zone',
                NAME: 'test'
            }
        },
        Handler: 'index.handler',
        Role: {
            'Fn::GetAtt': ['EcsPublicDiscoveryfunctionServiceRole6B6A990F', 'Arn']
        },
        Runtime: 'nodejs14.x'
    });

    template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
            Statement: [
                {
                    Action: 'sts:AssumeRole',
                    Effect: 'Allow',
                    Principal: {
                        Service: 'lambda.amazonaws.com'
                    }
                }
            ],
            Version: '2012-10-17'
        },
        ManagedPolicyArns: [
            {
                'Fn::Join': [
                    '',
                    ['arn:', {Ref: 'AWS::Partition'}, ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole']
                ]
            }
        ]
    });

    template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
            Statement: [
                {
                    Action: 'ec2:DescribeNetworkInterfaces',
                    Effect: 'Allow',
                    Resource: '*'
                },
                {
                    Action: 'route53:ChangeResourceRecordSets',
                    Effect: 'Allow',
                    Resource: {
                        'Fn::Join': ['', ['arn:', {Ref: 'AWS::Partition'}, ':route53:::hostedzone/test-hosted-zone']]
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

    template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
            'detail': {
                clusterArn: [{'Fn::GetAtt': ['TestClusterE0095054', 'Arn']}],
                desiredStatus: ['RUNNING'],
                group: [{'Fn::Join': ['', ['service:', {'Fn::GetAtt': ['TestServiceE2045282', 'Name']}]]}],
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
