import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Both fully private: Block Public Access enabled on all four settings, Object Ownership set to “Bucket owner enforced,”
    // and do not enable S3’s “static website hosting” toggle on either bucket. That toggle requires public access and is the
    // thing to specifically avoid here — CloudFront will be the only thing allowed to read from them.

    const stagingBucket = new cdk.aws_s3.Bucket(this, 'StagingBucket', {
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: cdk.aws_s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    });

    const productionBucket = new cdk.aws_s3.Bucket(this, 'ProductionBucket', {
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: cdk.aws_s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    });

  }
}
