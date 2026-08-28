# Decisions & Reasoning

## Phase 0 (First-off Decisions)

**Decision:** IaC-first - define all infrastructure as code with AWS CDK before building the pipeline.

**Why:** This is a greenfield project with nothing pre-existing to import against (no infrastructure currently in AWS console or created otherwise), so writing the infrastructure as code first costs nothing extra and gives us version-controlled, reviewable, repeatable infrastructure from day one.

**Expanding scope beyond the original brief:** CloudPipe asked for "push code, files show up on the website." I'm adding four things they didn't ask for, because a client describing a problem in their own words usually doesn't know to ask for the things that protect them later:

1. **OIDC integration (passwordless GitHub-to-AWS access):**
   GitHub Actions authenticates to AWS via OIDC instead of long-lived IAM access keys. GitHub exchanges a short-lived token with AWS STS for temporary credentials that expire quickly (e.g., 10 minutes), so there are no stored secrets in GitHub to leak. This rejects the common shortcut of an IAM user with a pasted-in access key, which is exactly the kind of credential that causes real breaches. The IAM role is scoped narrowly (this repo only, deploy permissions only) with an exact-match trust condition on the repo/branch.

2. **Staging and production environments:**
   Changes deploy to a private staging environment first (on every pull request), then get promoted to production only after merge to `main`. Staging catches mistakes before real visitors ever see them, closing the gap where "push to GitHub" and "live on the website" were the same moment.

3. **Rollback capability:**
   An undo button for bad deploys. S3 object versioning keeps previous versions of every deployed file rather than overwriting them, so production can be restored quickly by pointing CloudFront back at the last known-good version (plus a cache invalidation so visitors immediately see the restored files) instead of waiting on a new fix commit or manually re-uploading from memory.

4. **Monitoring and alerting:**
   A synthetic check requests the live production URL and a CloudWatch alarm fires if it fails, notifying the team via SNS. Pipeline failures also notify the team automatically; the goal is that the team hears about problems from a system, not from an angry client email.

5. **AI-assisted review step:**
   On each pull request, before anything reaches staging, the diff is scanned by an AI model that flags obvious red flags: accidentally-committed secrets/API keys, files that shouldn't be there, unusually large or risky changes. It posts its notes as a PR comment for the human reviewer. It is deliberately **non-blocking**: the AI never approves or rejects a deploy, a person reads the note and makes every actual decision.

---

## Phase 0.5 (Architecture Design & Diagram)

**1. What this task is solving**

Design the target-state architecture before any implementation, so the build follows a clear blueprint, mapping both the pipeline layer (how code flows to production) and the delivery layer (how visitors reach the site), and establishing the full component layout up front: GitHub, GitHub Actions, S3, CloudFront, ACM, and the OIDC trust.

**2. What I did**
- Designed the target-state architecture in Excalidraw (`diagram/Target-state-architecture-diagram.excalidraw`).
- Exported a PNG screenshot of the diagram (`screenshots/Target-state-architecture-diagram.png`).
- Mapped the pipeline layer: Developer → GitHub → GitHub Actions (with OIDC and AI review) → Staging → (approval/merge) → Production.
- Mapped the delivery layer: Visitor → CloudFront → S3, with ACM providing the certificate.
- Showed two separate CloudFront distributions (one per environment) and two S3 buckets (staging + production).
- Included the OIDC trust via AWS STS and the CloudFront cache-invalidation step.

**3. Why I did it**
- Design before implement: a clear blueprint catches issues before any code is written.
- Visualizing both layers makes the data flow and each component's role explicit and reviewable.
- The diagram doubles as the architecture diagram needed for the Phase 5 README.

**4. What I rejected**
- Starting implementation without a design (risks building the wrong thing).
- A single shared CloudFront/S3 setup for both environments (would lose staging isolation).
- Leaving the design as a throwaway sketch (it's a reference for the whole project).

---

## Phase 1 (AWS CDK Infrastructure)

### Task 1.0 (Environment Setup)

**1. What this task is solving**

Tell CDK which AWS account and region to deploy to before any code is written.

**2. What I did**
- Set the stack environment in `bin/infrastructure.ts`: account from `CDK_DEFAULT_ACCOUNT`, region hardcoded to `us-east-1`.

**3. Why I did it**
- ACM certificates for CloudFront must live in `us-east-1`, so the region needs to be explicit.

**4. What I rejected**
- Leaving the stack environment-agnostic (would break ACM/CloudFront in later tasks).

### Task 1A (S3 Buckets)

**1. What this task is solving**

Creates the storage layer for the website files, with two separate buckets (staging + production) so changes are tested privately before going live. Buckets stay fully private; CloudFront will be the only way to read from them.

**2. What I did**
- Defined two S3 buckets in `infrastructure/lib/infrastructure-stack.ts` using AWS CDK.
- Set `BlockPublicAccess.BLOCK_ALL` on both (blocks all four public-access settings).
- Set `ObjectOwnership.BUCKET_OWNER_ENFORCED` on both.
- Did not enable the static website hosting toggle.
- Assigned each bucket to a `const` so later phases can reference them.

**3. Why I did it**
- Keeps the buckets private so visitors can only reach the site through CloudFront (HTTPS, caching, CDN).
- Staging/production separation gives a safety net before changes reach real visitors.
- Defining as code makes the storage repeatable, version-controlled, and reviewable.

**4. What I rejected**
- Making the buckets public or enabling static website hosting (would let anyone bypass CloudFront and hit S3 directly).
- Using a single shared bucket for both environments (would remove the staging safety net).

### Task 1B (ACM Certificate + CloudFront Distributions)

**1. What this task is solving**

Adds the delivery layer: how visitors actually reach the website. Two CloudFront distributions (staging + production) serve each environment's bucket, an ACM certificate provides HTTPS for the site's domain, and Origin Access Control (OAC) lets CloudFront read the private buckets without making them public.

**2. What I did**
- Created an ACM certificate for the site domain (`example.com` + `*.example.com`).
- Created two CloudFront distributions, one per environment, each pointing at its own bucket.
- Wired each distribution to its bucket using `S3BucketOrigin.withOriginAccessControl(...)` (OAC, not the legacy OAI).
- Set `index.html` as the default root object on both distributions.
- Confirmed via `cdk synth` that each bucket's policy grants access only to its own distribution (via `AWS:SourceArn`), not to CloudFront broadly.

**3. Why I did it**
- Two distributions keep staging and production fully isolated at the delivery layer.
- OAC is the current recommended way to give CloudFront access while keeping buckets private.
- Scoping each bucket policy to its specific distribution prevents one distribution from reading the other's content.

**4. What I rejected**
- Using the legacy Origin Access Identity (OAI) instead of OAC.
- Making the buckets public or enabling static website hosting to serve the site.
- A single shared distribution for both environments (would lose staging isolation).

**Domain decision (placeholder):**
- No real domain is available for this project yet, so `example.com` is used as a placeholder.
- The ACM certificate stays in "pending validation" because the placeholder domain can't be validated (DNS/email).
- CloudFront requires an issued certificate, so the distributions are **not** attached to the certificate and instead use CloudFront's default `*.cloudfront.net` domain for now.
- When a real domain is added later: validate the certificate, then attach it with aliases to both distributions.

### Task 1C (OIDC Trust Between GitHub and AWS)

**1. What this task is solving**

Replaces stored AWS access keys with passwordless, short-lived credentials, letting GitHub Actions authenticate to AWS via OIDC instead of a long-lived IAM user key, and scopes access so only this repo can deploy, and only to the environments it's allowed to.

**2. What I did**
- Registered GitHub as an OIDC identity provider (`https://token.actions.githubusercontent.com`) with client ID `sts.amazonaws.com`.
- Created two IAM roles, one per environment, each with an exact-match (`StringEquals`) trust condition on the `sub` claim:
  - **Staging role:** `repo:PeaceMaker122/04-CloudPipe-Automation:pull_request` - any feature-branch PR can deploy to staging.
  - **Production role:** `repo:PeaceMaker122/04-CloudPipe-Automation:ref:refs/heads/main` - only merges to `main` can deploy to production.
- Scoped each role's permissions to exactly what it needs: read/write on its own bucket and `cloudfront:CreateInvalidation` on its own distribution.
- Confirmed via `cdk synth` that the trust conditions and permissions are correct.

**3. Why I did it**
- OIDC removes the risk of a leaked long-lived credential sitting in GitHub Secrets.
- Two roles give the tightest scoping: feature branches reach staging only, and only `main` reaches production.
- Exact-match trust conditions avoid the loose wildcard matching AWS warns against.
- Narrowly scoped permissions mean each role can only touch its own environment.

**4. What I rejected**
- A static IAM user with a long-lived access key pasted into GitHub (leak risk).
- A single shared deploy role for both environments (can't distinguish staging from production).
- Loose/wildcard trust matching on the `sub` claim (could trust more repos than intended).

### Task 1D (Monitoring)

**1. What this task is solving**

Detects when the live production site goes down after a deployment and alerts the team automatically so they hear about a problem from a system, not from an angry client email.

**2. What I did**
- Created a Lambda synthetic check (Python 3.12) that requests the production CloudFront URL and publishes a `HealthCheckFailed` metric (1 on failure, 0 on success).
- Scheduled it to run every 5 minutes via a CloudWatch Events rule.
- Created a CloudWatch alarm on the `HealthCheckFailed` metric that fires when a check fails.
- Created an SNS topic ("CloudPipe Production Alerts") and subscribed `stiaant1@gmail.com` to receive alerts.
- Wired the alarm to notify the SNS topic on failure.

**3. Why I did it**
- A synthetic check verifies the site actually loads, not just that a deployment ran.
- A schedule keeps the check running continuously without human involvement.
- SNS delivers the alert to email so the team is notified within minutes of a problem.

**4. What I rejected**
- Relying on manual checks or waiting for a customer to report an outage.
- Checking only the deployment status without verifying the live site responds.

---

## Phase 2 (GitHub Actions Pipeline)

### Task 2A (Staging Deployment)

**1. What this task is solving**

Automatically deploys website changes to the staging environment when a pull request is opened, giving the team a private copy of the site to review before anything reaches production.

**2. What I did**
- Created `.github/workflows/deploy-staging.yml` triggered on `pull_request` to `main`.
- Configured OIDC auth via the staging deploy role (`cloudpipe-staging-deploy-role`).
- Added a step that syncs `./website` to the staging S3 bucket.
- Added a step that invalidates the staging CloudFront cache.

**3. Why I did it**
- Staging deploys happen automatically on every PR, so no manual uploads.
- OIDC keeps credentials short-lived and scoped to the staging environment only.
- Cache invalidation ensures the staging site shows the latest files.

**4. What I rejected**
- Deploying straight to production on a PR (would skip the staging safety net).
- Using long-lived AWS credentials in the workflow.

### Task 2B (AI Review Step)

**1. What this task is solving**

Adds a non-blocking AI check that scans a pull request's diff for obvious risks before it reaches staging, flagging potential secrets, unusually large or risky changes, and missing files for a human reviewer.

**2. What I did**
- Created `.github/workflows/ai-review.yml` triggered on `pull_request` to `main`.
- Added a dedicated IAM role (`cloudpipe-ai-review-role`) scoped only to `bedrock:InvokeModel`.
- Configured OIDC auth via the AI review role.
- Computes the PR diff and sends it to Claude via Amazon Bedrock (`anthropic.claude-sonnet-5`).
- Posts the review as a PR comment using the GitHub API.
- Set `continue-on-error: true` so the step is non-blocking.

**3. Why I did it**
- Bedrock keeps the AI review inside AWS, so no external API key is needed.
- A dedicated role keeps Bedrock access separate from the deploy roles.
- Non-blocking keeps a human in the loop; the AI never approves or rejects a deploy.

**4. What I rejected**
- Using an external AI provider that requires an API key stored in GitHub.
- Making the AI review blocking (would let the AI gate deployments).
- Reusing the deploy roles for the AI review (would widen their permissions).

### Task 2C (Production Deployment)

**1. What this task is solving**

Automatically deploys to production when a change is merged to `main`, ensuring production only receives changes that were reviewed in staging.

**2. What I did**
- Created `.github/workflows/deploy-production.yml` triggered on `push` to `main`.
- Configured OIDC auth via the production deploy role (`cloudpipe-production-deploy-role`).
- Added a step that syncs `./website` to the production S3 bucket.
- Added a step that invalidates the production CloudFront cache.
- Added a failure notification step that runs if the deploy fails.

**3. Why I did it**
- Production deploys happen automatically on merge, so no manual steps.
- The merge to `main` acts as the promotion gate; production only gets tested changes.
- OIDC scopes the production role to merges to `main` only.

**4. What I rejected**
- Deploying to production from any branch (would bypass the promotion gate).
- Using a single shared deploy role for both environments.

---

## Phase 2.5 (Website Content)

**1. What this task is solving**

Provides the actual website files that the pipeline deploys, so the staging and production sync steps have real content to upload.

**2. What I did**
- Created `website/index.html`, a self-contained homepage for CloudPipe.
- Included inline CSS and a small script so it deploys cleanly without separate asset files.
- Added a header, a hero section, a note about the CI/CD deployment, a contact card, and a footer.

**3. Why I did it**
- The deploy workflows run `aws s3 sync ./website`, so the folder needs real files to sync.
- A self-contained page keeps the first deploy simple and avoids missing-asset issues.
- It gives the pipeline real content to test with during integration.

**4. What I rejected**
- Leaving the `website/` folder empty (the deploy steps would sync nothing).
- Adding separate CSS/JS asset files before the pipeline is proven (kept it simple for now).
