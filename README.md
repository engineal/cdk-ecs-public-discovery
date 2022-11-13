# Welcome to your CDK TypeScript Construct Library project

The poor man's alternative to the recommended approach of using an ELB for public ingress into your ECS service.

The provided CDK construct is similar to the functionality provided by AWS ECS Service Discovery (also known as CloudMap), but, instead
of registering the private IP address of the task in the DNS entry (even with a public CloudMap namespace), it will
register the public IP address of the task (this must be enabled for your service with AwsVpc network mode), allowing the public to use it.

This supports singleton tasks as well as multiple targets, enabling DNS routing to multiple tasks in a service.

## Installation

In your AWS CDK project, run

`npm install cdk-ecs-public-discovery` or `yarn install cdk-ecs-public-discovery`

## Usage



### Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run package` generates libraries for all languages
* `npm run test`    perform the jest unit tests

## License

Copyright 2022 Aaron Lucia

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
