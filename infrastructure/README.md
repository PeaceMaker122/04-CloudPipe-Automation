# CloudPipe Infrastructure

This folder contains the AWS CDK (TypeScript) infrastructure for the CloudPipe deployment pipeline. All infrastructure is defined as code, so it is version-controlled, reviewable, and repeatable.

## What it defines

The CDK stack provisions the following resources:

- **S3 buckets** for staging and production website files (private, versioned).
- **CloudFront distributions** for staging and production, using Origin Access Control (OAC).
- **ACM certificate** for HTTPS on the site's domain.
- **IAM OIDC provider and roles** for passwordless GitHub-to-AWS access.
- **Route 53 alias records** pointing the domain at CloudFront.
- **Monitoring**: a Lambda synthetic health check, a CloudWatch alarm, and an SNS topic for alerts.

The health check Lambda code lives in `lambda/health_check/`.

## Prerequisites

- Node.js and npm
- The AWS CLI, configured with your credentials (`aws configure`)
- The CDK CLI (`npm install -g aws-cdk`)

## Useful commands

- `npm run build` — type-check the project
- `npm run watch` — watch for changes and type-check
- `npm run test` — run the jest unit tests
- `npx cdk bootstrap` — one-time setup of the CDK toolkit resources
- `npx cdk synth` — emit the synthesized CloudFormation template
- `npx cdk diff` — compare the deployed stack with the current state
- `npx cdk deploy` — deploy the stack to your default AWS account/region
- `npx cdk destroy` — tear down the stack

Run the CDK commands from this folder (where `cdk.json` lives).