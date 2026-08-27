import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';

// GitHub repo that GitHub Actions will authenticate as. Used to scope the OIDC
// trust so only this repo can assume the deploy roles.
const GITHUB_OWNER = 'PeaceMaker122';
const GITHUB_REPO = '04-CloudPipe-Automation';

// Placeholder domain for the site. A real domain is not available yet, so the
// certificate below stays in "pending validation" and is not attached to the
// distributions (CloudFront requires an issued certificate). The distributions
// therefore use CloudFront's default *.cloudfront.net domain for now. When a
// real domain is added, validate the certificate and attach it with aliases.
const DOMAIN = 'example.com';

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

    // ACM certificate for the site's domain. Not attached to a distribution
    // yet: it stays pending validation until a real domain is available, and
    // CloudFront requires an issued certificate to attach.
    const certificate = new acm.Certificate(this, 'SiteCertificate', {
      domainName: DOMAIN,
      subjectAlternativeNames: [`*.${DOMAIN}`],
    });

    // Staging distribution: serves the staging bucket via OAC. Uses CloudFront's
    // default domain until a real domain is configured.
    const stagingDistribution = new cloudfront.Distribution(this, 'StagingDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(stagingBucket),
      },
      defaultRootObject: 'index.html',
    });

    // Production distribution: serves the production bucket via OAC. Uses
    // CloudFront's default domain until a real domain is configured.
    const productionDistribution = new cloudfront.Distribution(this, 'ProductionDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(productionBucket),
      },
      defaultRootObject: 'index.html',
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
  }
}