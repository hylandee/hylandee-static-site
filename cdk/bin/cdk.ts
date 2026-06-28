#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { HylandeeStack } from '../lib/cdk-stack';

const app = new cdk.App();
new HylandeeStack(app, 'HylandeeStack', {
  env: { account: '320326036945', region: 'us-east-1' },
});
