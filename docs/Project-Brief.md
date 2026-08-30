# Project Brief: CloudPipe CI/CD Pipeline

## Executive Summary

CloudPipe is a small web development company that builds websites for local businesses. Today, their developers deploy changes by manually uploading files to production servers. This process is slow, error-prone, and stressful: a simple text change can take 15 to 20 minutes to deploy, and a forgotten file can take a site down for hours before anyone notices.

This project delivers a modern CI/CD pipeline that automates the build, test, and deployment of website changes whenever code is pushed to GitHub. The goal is to make deployments faster, more reliable, and less stressful for the team, while adding the safety and security measures a production pipeline needs.

---

## Background

CloudPipe's developers currently deploy by hand:

1. Downloading the latest files from GitHub.
2. Manually uploading them to the production server.
3. Hoping no files were forgotten.
4. Checking that everything still works.

This manual process has real costs. In one recent incident, a developer forgot to upload an updated JavaScript file, and the contact form was broken for several hours before anyone noticed. Time spent on repetitive uploads is time not spent building features.

CloudPipe's core need is simple: "push code, files show up on the website". That is a real need, and this project delivers it. But a client describing a problem in their own words rarely asks for the protections that matter later, so as the cloud engineer I am making deliberate decisions to go beyond the basics and give CloudPipe something better. This brief therefore covers both the core need and the safeguards a production deployment pipeline should have.

---

## Objectives

The project will:

- **Automate deployment** so code pushed to GitHub triggers a deployment automatically, with clear success or failure feedback.
- **Add a safe testing step** so changes go to a private staging environment before reaching the live site.
- **Provide a way to undo a bad deployment** by rolling back to the last known-good version quickly.
- **Secure GitHub-to-AWS access** without storing any long-lived credentials.
- **Add monitoring** so the team is alerted automatically if the site goes down.

---

## Scope

### In scope

- A CI/CD pipeline that deploys website changes on push.
- A staging environment for testing changes before they go live.
- A production environment serving the public website.
- A rollback mechanism using S3 object versioning.
- Passwordless (OIDC) authentication between GitHub and AWS.
- Monitoring and alerting via CloudWatch and SNS.
- An AI-assisted code review step on pull requests.
- All infrastructure defined as code with AWS CDK.

### Out of scope (for now)

- **AWS WAF** (a web application firewall) is intentionally excluded for cost reasons. A web ACL costs around $5/month plus about $1/month per rule, which is not justified for a low-traffic marketing site. This is a deliberate cost-versus-security trade-off, and a natural next step if traffic or risk grows.
- **CloudFront Continuous Deployment** (gradual traffic-shifted rollouts) is deferred. The simpler S3-versioning rollback meets the need today; Continuous Deployment is a "what I would do at scale" upgrade.

---

## Requirements

### 1. Automated Deployment
- Code pushed to GitHub automatically triggers a deployment.
- Developers can see at a glance whether a deployment succeeded or failed.
- The team is notified automatically if something goes wrong, not by a customer noticing a broken page first.

### 2. A Safe Testing Step Before Going Live
- Changes deploy to a private **staging** environment first, visible only to the team.
- Only after staging looks correct is the change promoted to **production**, the real public website.

### 3. A Way to Undo a Bad Deployment
- A documented way to roll back to the last known-good version quickly, without manually re-uploading old files.

### 4. Secure, Passwordless Access from GitHub to AWS
- GitHub Actions can deploy to AWS without ever storing a long-lived AWS password or key in GitHub, using OIDC.

### 5. Monitoring and Alerting
- A synthetic check verifies the live site responds correctly.
- A CloudWatch alarm fires on failure and an SNS topic notifies the team.

### 6. AI-Assisted Review
- Before a deployment goes out, an AI model checks the code changes for obvious risks, such as an accidentally committed secret key, and flags anything worth a second look.
- A human always makes the final call; the AI never blocks or approves a deployment on its own.

---

## Technology

- **Amazon S3** stores the website files in fully private buckets.
- **Amazon CloudFront** serves the site as a CDN, reaching into the private buckets using Origin Access Control (OAC).
- **AWS Certificate Manager (ACM)** provides the HTTPS certificate.
- **GitHub Actions** runs the automation on every push.
- **AWS CDK** defines all infrastructure as code.
- **Amazon CloudWatch + SNS** provide monitoring and alerting.
- **Amazon Bedrock** powers the AI-assisted review step.

---

## Success Criteria

The solution is successful if:

1. Deployments happen automatically when code is pushed.
2. Changes are tested in staging before reaching the real website.
3. The team is notified immediately if a deployment fails, or if the live site breaks after a deployment.
4. A bad deployment can be rolled back quickly and predictably.
5. No long-lived AWS credentials are stored anywhere in GitHub.
6. The whole pipeline, including the website hosting infrastructure, is defined as code rather than built by hand in the AWS console.

---

## Deliverables

- A CI/CD pipeline with staging and production environments.
- Website hosting infrastructure defined as code.
- A rollback process, tested end to end.
- Monitoring and alerting, tested end to end.
- An AI-assisted code review step.
- Documentation covering the architecture, decisions, and how the pipeline works.
