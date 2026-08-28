import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as path from 'path';

// Email that receives SNS alerts when the production site fails its health check.
const ALERT_EMAIL = 'stiaant1@gmail.com';

// GitHub repo that GitHub Actions will authenticate as. Used to scope the OIDC
// trust so only this repo can assume the deploy roles.
const GITHUB_OWNER = 'PeaceMaker122';
const GITHUB_REPO = '04-CloudPipe-Automation';

// Real domain for the site, purchased via Route 53. The certificate is validated
// via DNS in the hosted zone, and both distributions use aliases under this domain.
const DOMAIN = 'stiaan.click';

/**
 * Core infrastructure for the CloudPipe deployment pipeline.
 *
 * Defines the storage layer (S3), the delivery layer (CloudFront + ACM), and
 * the secure access path between them via Origin Access Control (OAC).
 */
export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Staging bucket: holds the private copy of the site that is updated on
    // every pull request. Versioning is enabled so previous deploys can be
    // restored if a change breaks something.
    const stagingBucket = new cdk.aws_s3.Bucket(this, 'StagingBucket', {
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: cdk.aws_s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
    });

    // Production bucket: holds the real, public website. Versioning is enabled
    // so a bad deploy can be rolled back to the last known-good version.
    const productionBucket = new cdk.aws_s3.Bucket(this, 'ProductionBucket', {
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: cdk.aws_s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
    });

    // Hosted zone for the domain, created automatically when the domain was
    // registered in Route 53. Used for DNS validation and alias records.
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: DOMAIN,
    });

    // ACM certificate for the site's domain, validated via DNS in the hosted
    // zone so CloudFront can attach it. Covers the production domain, www, and
    // the staging subdomain.
    const certificate = new acm.Certificate(this, 'SiteCertificate', {
      domainName: DOMAIN,
      subjectAlternativeNames: [`www.${DOMAIN}`, `staging.${DOMAIN}`],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Staging distribution: serves the staging bucket via OAC, using the
    // staging subdomain and the shared certificate.
    const stagingDistribution = new cloudfront.Distribution(this, 'StagingDistribution', {
      certificate,
      domainNames: [`staging.${DOMAIN}`],
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(stagingBucket),
      },
      defaultRootObject: 'index.html',
    });

    // Production distribution: serves the production bucket via OAC, using the
    // apex domain and www, with the shared certificate.
    const productionDistribution = new cloudfront.Distribution(this, 'ProductionDistribution', {
      certificate,
      domainNames: [DOMAIN, `www.${DOMAIN}`],
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(productionBucket),
      },
      defaultRootObject: 'index.html',
    });

    // Route 53 alias records: point the domains at their CloudFront distributions.
    new route53.ARecord(this, 'StagingAliasRecord', {
      zone: hostedZone,
      recordName: `staging.${DOMAIN}`,
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(stagingDistribution)),
    });
    new route53.ARecord(this, 'ProductionAliasRecord', {
      zone: hostedZone,
      recordName: DOMAIN,
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(productionDistribution)),
    });
    new route53.ARecord(this, 'WwwAliasRecord', {
      zone: hostedZone,
      recordName: `www.${DOMAIN}`,
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(productionDistribution)),
    });

    // OIDC identity provider: registers GitHub as a trusted identity source so
    // GitHub Actions can request short-lived AWS credentials without storing
    // any long-lived access keys in the repo.
    const githubProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    // Staging deploy role: assumable only by pull requests from this repo, so
    // any developer's feature-branch PR can deploy to staging. Scoped to write
    // to the staging bucket and invalidate the staging distribution.
    const stagingDeployRole = new iam.Role(this, 'GitHubStagingDeployRole', {
      roleName: 'cloudpipe-staging-deploy-role',
      assumedBy: new iam.FederatedPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': `repo:${GITHUB_OWNER}/${GITHUB_REPO}:pull_request`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      description: 'Allows GitHub Actions to deploy to staging on pull requests',
    });
    stagingBucket.grantReadWrite(stagingDeployRole);
    stagingDistribution.grantCreateInvalidation(stagingDeployRole);

    // Production deploy role: assumable only by merges to main, so production
    // only ever receives changes that were reviewed in staging. Scoped to write
    // to the production bucket and invalidate the production distribution.
    const productionDeployRole = new iam.Role(this, 'GitHubProductionDeployRole', {
      roleName: 'cloudpipe-production-deploy-role',
      assumedBy: new iam.FederatedPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': `repo:${GITHUB_OWNER}/${GITHUB_REPO}:ref:refs/heads/main`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      description: 'Allows GitHub Actions to deploy to production on merge to main',
    });
    productionBucket.grantReadWrite(productionDeployRole);
    productionDistribution.grantCreateInvalidation(productionDeployRole);

    // AI review role: assumable by pull requests, scoped only to invoke Bedrock
    // for the AI code-review step. Kept separate from the deploy roles so those
    // stay narrowly scoped to their own environments.
    const aiReviewRole = new iam.Role(this, 'GitHubAiReviewRole', {
      roleName: 'cloudpipe-ai-review-role',
      assumedBy: new iam.FederatedPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': `repo:${GITHUB_OWNER}/${GITHUB_REPO}:pull_request`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      description: 'Allows GitHub Actions to review pull requests with Amazon Bedrock',
    });
    aiReviewRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/*`],
      }),
    );

    // SNS topic: receives alerts when the production site fails its health check.
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      displayName: 'CloudPipe Production Alerts',
    });
    alertTopic.addSubscription(new subscriptions.EmailSubscription(ALERT_EMAIL));

    // Synthetic check: a Lambda function that requests the production URL on a
    // schedule and publishes a metric (1 on failure, 0 on success).
    const healthCheckFn = new lambda.Function(this, 'HealthCheckFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'health_check.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'health_check')),
      timeout: cdk.Duration.seconds(30),
      environment: {
        PRODUCTION_URL: `https://${DOMAIN}`,
      },
    });

    // Run the health check every 5 minutes.
    const schedule = new events.Rule(this, 'HealthCheckSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
    });
    schedule.addTarget(new targets.LambdaFunction(healthCheckFn));

    // Alarm: fires when the health check reports a failure.
    const healthCheckAlarm = new cloudwatch.Alarm(this, 'HealthCheckAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'CloudPipe',
        metricName: 'HealthCheckFailed',
        statistic: 'Maximum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Production site failed its health check',
    });
    healthCheckAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alertTopic));

    // Outputs: expose the resource identifiers the GitHub Actions workflows need.
    new cdk.CfnOutput(this, 'StagingBucketName', { value: stagingBucket.bucketName });
    new cdk.CfnOutput(this, 'ProductionBucketName', { value: productionBucket.bucketName });
    new cdk.CfnOutput(this, 'StagingDistributionId', { value: stagingDistribution.distributionId });
    new cdk.CfnOutput(this, 'ProductionDistributionId', { value: productionDistribution.distributionId });
    new cdk.CfnOutput(this, 'StagingDeployRoleArn', { value: stagingDeployRole.roleArn });
    new cdk.CfnOutput(this, 'ProductionDeployRoleArn', { value: productionDeployRole.roleArn });
    new cdk.CfnOutput(this, 'AiReviewRoleArn', { value: aiReviewRole.roleArn });
  }
}