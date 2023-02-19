import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodeJs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import {Duration, Stack, Tags} from 'aws-cdk-lib';
import {Construct} from 'constructs';

export interface EcsPublicDiscoveryProps {

    /**
     * The ECS cluster to enable ECS public discovery for
     */
    readonly cluster: ecs.ICluster;

    /**
     * The Route 53 hosted zone to create DNS entries in
     */
    readonly hostedZone: route53.IHostedZone;

    /**
     * Enable AWS X-Ray Tracing for Lambda Functions
     *
     * @default Tracing.Disabled
     */
    readonly tracing?: lambda.Tracing;
}

export interface ServiceOptions {

    /**
     * The ECS service to create DNS entries for
     */
    readonly service: ecs.BaseService;

    /**
     * A name for the Service.
     */
    readonly name: string;

    /**
     * The amount of time that you want DNS resolvers to cache the settings for this record.
     *
     * @default Duration.minutes(1)
     */
    readonly dnsTtl?: Duration;
}

export class EcsPublicDiscovery extends Construct {

    private readonly cluster: ecs.ICluster;

    constructor(scope: Construct, id: string, props: EcsPublicDiscoveryProps) {
        super(scope, id);

        this.cluster = props.cluster;

        const route53UpdaterFunction = new lambdaNodeJs.NodejsFunction(this, 'function', {
            bundling: {
                minify: true
            },
            environment: {
                HOSTED_ZONE_ID: props.hostedZone.hostedZoneId,
                HOSTED_ZONE_NAME: props.hostedZone.zoneName
            },
            logRetention: logs.RetentionDays.ONE_YEAR,
            tracing: props.tracing
        });

        route53UpdaterFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ec2:DescribeNetworkInterfaces'],
            resources: ['*']
        }));
        route53UpdaterFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'route53:ListResourceRecordSets',
                'route53:ChangeResourceRecordSets'
            ],
            resources: [Stack.of(this).formatArn({
                account: '',
                region: '',
                resource: 'hostedzone',
                resourceName: props.hostedZone.hostedZoneId,
                service: 'route53'
            })]
        }));

        new events.Rule(this, 'Route53UpdaterFunctionRule', {
            eventPattern: {
                detail: {
                    clusterArn: [props.cluster.clusterArn],
                    desiredStatus: ['RUNNING', 'STOPPED'],
                    lastStatus: ['RUNNING']
                },
                detailType: ['ECS Task State Change'],
                source: ['aws.ecs']
            }
        }).addTarget(new eventsTargets.LambdaFunction(route53UpdaterFunction));
    }

    addService(options: ServiceOptions) {
        if (options.service.cluster !== this.cluster) {
            throw new Error('The service must be part of the same cluster!');
        }

        const {taskDefinition} = options.service;

        // Validate that the service has the right network mode
        if (taskDefinition.networkMode !== ecs.NetworkMode.AWS_VPC) {
            throw new Error('Cannot use ECS public discovery if NetworkMode is not AWS_VPC.');
        }

        Tags.of(options.service).add('public-discovery:name', options.name);
        if (options.dnsTtl) {
            Tags.of(options.service).add('public-discovery:ttl', String(options.dnsTtl.toSeconds()));
        }
    }

}
