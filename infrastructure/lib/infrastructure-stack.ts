import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * Core infrastructure for the CloudPipe deployment pipeline.
 *
 * Defines the storage layer for the website. Both environments (staging and
 * production) are kept fully private and are only reachable through CloudFront,
 * which is added in a later task.
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
  }
}