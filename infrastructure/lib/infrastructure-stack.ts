import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

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
  }
}