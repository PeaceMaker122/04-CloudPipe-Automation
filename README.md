# CloudPipe DevOps

CloudPipe is a small web development company that builds websites for local businesses. Their developers used to upload files to production servers by hand whenever they made a change. That manual process was slow, error-prone, and stressful: a simple text change could take 15 to 20 minutes to deploy, and a forgotten file could take the site down for hours before anyone noticed.

This project replaces that manual workflow with a modern CI/CD pipeline. Code pushed to GitHub is automatically tested, deployed to a private staging environment, reviewed, and promoted to production. The result is faster, more reliable, and less stressful deployments.

![Target state architecture](screenshots/01-Target-state-architecture-diagram.png)

---

## The Problem

Every time a developer needed to update a website, they had to:

1. Download the latest files from GitHub.
2. Manually upload them to the production server.
3. Hope they did not forget any files.
4. Check that everything still worked.

This was time-consuming and prone to error. CloudPipe asked for the basics: "push code, files show up on the website." But a client describing a problem in their own words rarely asks for the things that protect them later. So beyond the literal ask, this project closes three gaps:

- **A safe way to give GitHub permission to touch AWS**, without storing a long-lived password that could leak.
- **An undo button**, so a bad deployment can be rolled back quickly instead of waiting on a fix commit.
- **A safety net before changes go live**, so mistakes are caught in staging before real visitors ever see them.

---

## The Solution

The project follows an IaC-first approach: all infrastructure is defined as code with AWS CDK, so it is version-controlled, reviewable, and repeatable. The architecture has two layers:

- **The pipeline layer:** Developer → GitHub → GitHub Actions (with OIDC and AI review) → Staging → (approval/merge) → Production.
- **The delivery layer:** Visitor → CloudFront → S3, with ACM providing the HTTPS certificate.

### Storage: S3

Two fully private S3 buckets hold the website files, one for staging and one for production. Both have Block Public Access enabled on all four settings, bucket-owner-enforced ownership, and object versioning enabled (which powers the rollback strategy). The static website hosting toggle is deliberately not used, so the buckets are never reachable directly.

![S3 buckets](screenshots/09-s3-buckets.png)
*The two S3 buckets, one for staging and one for production.*

![S3 versioning](screenshots/10-s3-versioning.png)
*Object versioning enabled, which powers the rollback strategy.*

![S3 bucket policy](screenshots/11-s3-bucket-policy-OAC.png)
*The bucket policy grants access only to the specific CloudFront distribution.*

### Delivery: CloudFront + ACM

Two CloudFront distributions serve the site, one per environment. Each connects to its bucket using Origin Access Control (OAC), so CloudFront is the only thing allowed to read the private buckets. An ACM certificate provides HTTPS for the domain.

![CloudFront distributions](screenshots/12-cloudfront-distributions.png)
*The two distributions, one per environment.*

![CloudFront OAC](screenshots/13-cloudfront-OAC.png)
*Origin Access Control configured, not the legacy OAI.*

![ACM certificate](screenshots/14-acm-certificate.png)
*The HTTPS certificate for the domain, issued.*

### Secure access: OIDC

GitHub Actions authenticates to AWS using OIDC instead of long-lived access keys. GitHub exchanges a short-lived token with AWS STS for temporary credentials that expire quickly, so there are no stored secrets in GitHub to leak.

**ADR: OIDC instead of static credentials.** The rejected alternative was an IAM user with a long-lived access key pasted into GitHub. That key sits there indefinitely, and if it leaks, whoever has it can act as that AWS user until someone notices. OIDC removes that risk entirely: credentials are short-lived, scoped to this repo, and expire on their own.

The trust is scoped tightly. Three IAM roles exist, one per environment plus one for the AI review, each with an exact-match trust condition on the `sub` claim:

- **Staging role:** assumable only by pull requests from this repo.
- **Production role:** assumable only by merges to `main`.
- **AI review role:** assumable only by pull requests, scoped to invoke Bedrock.

![IAM OIDC provider](screenshots/15-iam-oidc-provider.png)
*GitHub registered as an OIDC identity provider.*

![IAM roles](screenshots/16-iam-roles.png)
*The three scoped deploy roles.*

![IAM trust policy](screenshots/17-iam-trust-policy.png)
*The exact-match trust condition on the sub claim.*

### The pipeline: GitHub Actions

Three workflows drive the pipeline:

- **Deploy to Staging** runs on every pull request, syncing the website to the staging bucket and invalidating the staging cache.
- **AI Review** runs on every pull request, sending the diff to Claude via Amazon Bedrock and posting a non-blocking comment for a human reviewer.
- **Deploy to Production** runs on every merge to `main`, syncing to the production bucket, invalidating the cache, and notifying the team on failure.

![Workflow runs](screenshots/02-actions-workflows.png)
*The pipeline workflows as they appear in GitHub Actions.*

![Workflow files](screenshots/08-workflow-files.png)
*The pipeline defined as code in the workflow files.*

Because production only deploys on a merge to `main`, and a merge only happens after a pull request that was deployed to staging and reviewed, production only ever receives tested changes. The merge is the promotion gate.

![Staging deploy](screenshots/03-staging-deploy-success.png)
*The staging deployment run, all steps green.*

![AI review deploy](screenshots/04-ai-review-deploy-success.png)
*The AI review workflow run, all steps green.*

![Production deploy](screenshots/05-production-deploy-success.png)
*The production deployment run, all steps green.*

![Pull request flow](screenshots/07-pull-request-flow.png)
*The pull request flow from feature branch to merge.*

The AI review is a genuine part of the story. During the build it flagged real issues, including the exact OIDC `sub` claim format change that had broken authentication, and later caught a deliberately introduced typo.

![AI review comment](screenshots/06-ai-review-comment.png)
*The AI review flagging the real issues found during the build, including the OIDC sub claim format change.*

![AI review comment (clean)](screenshots/06-ai-review-comment-CLEAN.png)
*A later, clean AI review comment on a pull request with no issues flagged.*

### Monitoring: CloudWatch + SNS

A Lambda synthetic check requests the live production URL every five minutes and publishes a health metric. If the site fails to respond, a CloudWatch alarm fires and an SNS topic notifies the team by email. The team hears about a problem from a system, not from an angry client email.

![Lambda function](screenshots/20-lambda-function.png)
*The health check Lambda function.*

![CloudWatch alarm](screenshots/18-cloudwatch-alarm.png)
*The health check alarm.*

![SNS topic](screenshots/19-sns-topic.png)
*The SNS topic that sends the alert.*

### Domain: Route 53

The site runs on a real domain, `stiaan.click`, purchased via Route 53. Alias records point the domain and its subdomains at the CloudFront distributions.

![Route 53 hosted zone](screenshots/21-route53-hosted-zone.png)
*The hosted zone and alias records for the domain.*

---

## Rollback

**ADR: S3 object versioning for rollback.** Because the production bucket has versioning enabled, every deployed file's previous version is kept rather than overwritten. Rolling back means restoring the last known-good version and invalidating the CloudFront cache, so visitors immediately see the restored site. This was chosen over CloudFront Continuous Deployment, which is more powerful but more infrastructure than a small site needs on day one.

The rollback was tested for real. First, a deliberate typo was deployed that broke the page title and layout.

![Good site before](screenshots/25-good-site-before.png)
*The site working correctly before the break.*

![Bad commit](screenshots/26-bad-commit-noise-raiser.png)
*The commit that introduced the deliberate typo.*

![Broken site](screenshots/27-broken-site-typo.png)
*The site with the broken title and layout.*

Then the previous good version was restored and the cache invalidated.

![S3 versioning restore](screenshots/28-s3-versioning-restore.png)
*Restoring the previous good version in S3.*

![CloudFront invalidation](screenshots/29-cloudfront-invalidation.png)
*Invalidating the CloudFront cache so visitors see the restored version.*

![Site restored](screenshots/30-site-restored.png)
*The site back to normal after the rollback.*

---

## Monitoring Tested End to End

The monitoring flow was also tested for real. The site was broken so it returned an error, the synthetic check detected the failure, the CloudWatch alarm went to In alarm, and an SNS notification was sent to the alert email. The site was then fixed forward and confirmed healthy.

![Bad commit breaking the site](screenshots/31-break-website-bad-commit.png)
*The commit that removed index.html to break the site.*

![Broken site error](screenshots/32-broken-site-404.png)
*The site returning an error response.*

![Alarm firing](screenshots/33-cloudwatch-alarm-firing.png)
*The CloudWatch alarm in In alarm state.*

![SNS notification](screenshots/34-sns-email-notification.png)
*The SNS alert email notifying the team.*

![Site healthy](screenshots/35-site-healthy-after-fix.png)
*The site healthy again after the fix.*

---

## The Live Site

The finished production site is live at `https://stiaan.click`. A separate staging environment is used internally for testing changes before they reach production.

![Live production site](screenshots/22-live-site-production.png)
*The live production site.*

![Staging site](screenshots/23-staging-site.png)
*The internal staging environment.*

![CDK deploy output](screenshots/24-cdk-deploy-output.png)
*The CDK deployment output showing the deployed resources.*

---

## What I Would Do at Scale

This build is deliberately sized for a small business's low-traffic marketing site. At scale, I would consider:

- **CloudFront Continuous Deployment** instead of S3-versioning rollback, for gradual traffic-shifted rollouts with instant rollback.
- **AWS WAF** in front of production. It was intentionally left out here for cost reasons (about $5/month per web ACL plus about $1/month per rule), not because it is not a real best practice. This is a documented cost-versus-security trade-off.
- **Multi-region deployment** and a real automated test suite gate before staging deploy even runs.

---

## Project Structure

```text
04-CloudPipe-Automation/
├── website/                # the website files (index.html)
├── infrastructure/         # AWS CDK code (TypeScript)
│   ├── bin/
│   ├── lib/                # stack definitions: S3, CloudFront, ACM, OIDC, monitoring
│   └── lambda/             # the health check Lambda
├── .github/
│   └── workflows/          # GitHub Actions pipeline definitions
├── docs/                   # decisions log and project documents
├── diagram/                # the architecture diagram source
└── screenshots/            # evidence used in this README
```