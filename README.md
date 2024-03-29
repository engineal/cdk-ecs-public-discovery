# ECS Public Discovery

The poor man's DNS-based load balancing alternative to the recommended approach of using an ELB for public ingress into
your ECS service.

The provided CDK construct offers similar functionality to what AWS provides through ECS Service Discovery (also known
as AWS Cloud Map), but instead of creating DNS entries with the private IP address of the task (even with a public Cloud
Map namespace), it will register the public IP address of the task.

This can support services with multiple tasks through the use of Route53's multi-value answer routing.

Use cases for this construct would be applications where you want public ingress to an ECS service and don't require
and want the added cost of a load balancer. Some examples could be:
* an application where there is only ever a single task running, such as a game server
* development applications or tooling
* applications where load balancing between tasks isn't required

This isn’t a replacement for a network or application load balancing solution and consideration should be given to how
the application, resolvers, and clients will handle DNS caching and multi-value DNS answers.

## Installation

### TypeScript / JavaScript

`npm install cdk-ecs-public-discovery`

or

`yarn add cdk-ecs-public-discovery`

### Python

`pip install cdk-ecs-public-discovery`

### Java

```xml
<dependency>
    <groupId>com.engineal.cdk</groupId>
    <artifactId>ecs-public-discovery</artifactId>
</dependency>
```

### C# / .Net

`dotnet add package EngineAL.CDK.EcsPublicDiscovery`

## Usage

Create a new `EcsPublicDiscovery` construct for your ECS cluster. Provide the Route53 Hosted Zone to create DNS entries
in.

```typescript
const cluster = new ecs.Cluster(stack, 'TestCluster');
const hostedZone = route53.HostedZone.fromHostedZoneAttributes(stack, 'HostedZone', {
    hostedZoneId: 'Z1R8UBAEXAMPLE',
    zoneName: 'example.com'
});

const ecsPublicDiscovery = new EcsPublicDiscovery(stack, 'EcsPublicDiscovery', {
    cluster,
    hostedZone
});
```

Then for each service you create in that cluster that you want to enable public routing to, set `assignPublicIp` to
`true` and register it with the `EcsPublicDiscovery` construct you created:

```typescript
const taskDefinition = new ecs.FargateTaskDefinition(stack, 'TestTaskDefinition');

taskDefinition.addContainer('TestContainer', {
    image: ecs.ContainerImage.fromRegistry('hello-world')
});

const service = new ecs.FargateService(stack, 'TestService', {
    assignPublicIp: true,
    cluster,
    taskDefinition
});

ecsPublicDiscovery.addService({
    dnsTtl: cdk.Duration.minutes(1),
    name: 'test',
    service
});
```

## Details

This construct creates a Lambda function that is triggered by an EventBridge rule that listens for when an ECS task is
running or has stopped and upserts or deletes a record for that task in Route53.

Each ECS service registered with this construct is tagged with the `public-discovery:name` and optionally the
`public-discovery:ttl` tags based on the props you provide, which will be propagated to the service's tasks and the
network interface attached to the task. The ECS task definition must use the AwsVpc network mode, and the ECS service
must assign a public IP to its tasks' network interface.

When a task is running, the Lambda function will call the EC2 `DescribeNetworkInterfaces` API action to describe the
task's network interface to look up the public IP address and tags assigned to the task. It will then call the
Route53 `ChangeResourceRecordSets` API action to upsert an A record, using the public IP address as the value of the
resource record, the value of the `public-discovery:name` tag as the name, the value of the `public-discovery:ttl` tag
as the TTL if present or 60 seconds if absent, and the task's id as the set identifier to allow for multi-value routing.

When the task has stopped, the Lambda function will call the Route53 `ListResourceRecordSets` API action to look up the
resource record set for the task's id and will then call the Route53 `ChangeResourceRecordSets` API action to delete
that A record.

**An important note when using this with an ECS service that has multiple tasks**: while Route53 does return values for a
multi-value answer in a random order, and typically clients will round-robin over the values in the answer, any load
balancing between tasks is dependent on the client and no guarantee can be made on the distribution of traffic to
multiple tasks. Also, while multi-value answer routing does return values in a random order to the client, it will only
return up to 8 random values per request. If there are more than 8 tasks per service, a single client will only be aware
of 8 tasks at once. If a resolver is used between Route53 and clients and caches those 8 values, multiple clients could
end up only being aware of the same 8 tasks as well.

### Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run package` generates libraries for all languages
* `npm run test`    perform the jest unit tests

## License

Copyright 2023 Aaron Lucia

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
