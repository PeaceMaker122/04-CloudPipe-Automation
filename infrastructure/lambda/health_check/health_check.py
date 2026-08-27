import json
import os
import urllib.request

import boto3


def handler(event, context):
    """Synthetic health check for the production site.

    Requests the production URL and publishes a CloudWatch metric:
    1 if the request fails, 0 if it succeeds. The CloudWatch alarm
    watches this metric and alerts the team via SNS on failure.
    """
    url = os.environ["PRODUCTION_URL"]
    cloudwatch = boto3.client("cloudwatch")

    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            failed = 0 if response.status < 400 else 1
    except Exception:
        failed = 1

    cloudwatch.put_metric_data(
        Namespace="CloudPipe",
        MetricData=[
            {
                "MetricName": "HealthCheckFailed",
                "Value": failed,
                "Unit": "Count",
            }
        ],
    )