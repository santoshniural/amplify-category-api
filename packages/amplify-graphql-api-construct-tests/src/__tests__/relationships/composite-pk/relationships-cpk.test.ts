import * as path from 'path';
import * as fs from 'fs-extra';

import { DDB_AMPLIFY_MANAGED_DATASOURCE_STRATEGY } from '@aws-amplify/graphql-transformer-core';
import { createNewProjectDir, deleteProjectDir } from 'amplify-category-api-e2e-core';
import { cdkDeploy, cdkDestroy, initCDKProject } from '../../../commands';
import { TestDefinition, writeStackPrefix, writeTestDefinitions } from '../../../utils';
import {
  testPrimaryCpkSkOneContainsAssociated,
  testPrimaryCpkSkTwoContainAssociated,
  testRelatedManyCpkSkOneContainsAssociated,
  testRelatedManypkSkTwoContainsAssociated,
  testRelatedOneCpkSkOneContainsAssociated,
  testRelatedOneCpkSkTwoContainsAssociated,
} from './test-implementations';

jest.setTimeout(1000 * 60 * 60 /* 1 hour */);

describe('Relationships defined using composite primary are supported', () => {
  const baseProjFolderName = 'composite-pk';

  describe('DDB Primary, DDB Related', () => {
    const projFolderName = `${baseProjFolderName}-ddb-primary-ddb-related`;
    let apiEndpoint: string;
    let apiKey: string;
    let projRoot: string;
    let currentId: number;

    beforeEach(() => {
      currentId = Date.now();
    });

    beforeAll(async () => {
      projRoot = await createNewProjectDir(projFolderName);
      const templatePath = path.resolve(path.join(__dirname, '..', '..', 'backends', 'configurable-sandbox-stack'));
      const name = await initCDKProject(projRoot, templatePath);

      const primarySchemaOneSkPath = path.resolve(path.join(__dirname, 'graphql', 'schema-primary-cpk-1sk.graphql'));
      const primarySchemaOneSk = fs.readFileSync(primarySchemaOneSkPath).toString();

      const relatedSchemaOneSkPath = path.resolve(path.join(__dirname, 'graphql', 'schema-related-cpk-1sk.graphql'));
      const relatedSchemaOneSk = fs.readFileSync(relatedSchemaOneSkPath).toString();

      const primarySchemaTwoSkPath = path.resolve(path.join(__dirname, 'graphql', 'schema-primary-cpk-2sk.graphql'));
      const primarySchemaTwoSk = fs.readFileSync(primarySchemaTwoSkPath).toString();

      const relatedSchemaTwoSkPath = path.resolve(path.join(__dirname, 'graphql', 'schema-related-cpk-2sk.graphql'));
      const relatedSchemaTwoSk = fs.readFileSync(relatedSchemaTwoSkPath).toString();

      const testDefinitions: Record<string, TestDefinition> = {
        'ddb-primary-ddb-related': {
          schema: [primarySchemaOneSk, relatedSchemaOneSk, primarySchemaTwoSk, relatedSchemaTwoSk].join('\n'),
          strategy: DDB_AMPLIFY_MANAGED_DATASOURCE_STRATEGY,
        },
      };

      writeStackPrefix('RefCpkDdbDdb', projRoot);
      writeTestDefinitions(testDefinitions, projRoot);

      const outputs = await cdkDeploy(projRoot, '--all');
      apiEndpoint = outputs[name].awsAppsyncApiEndpoint;
      apiKey = outputs[name].awsAppsyncApiKey;
    });

    afterAll(async () => {
      try {
        await cdkDestroy(projRoot, '--all');
      } catch (err) {
        console.log(`Error invoking 'cdk destroy': ${err}`);
      }

      deleteProjectDir(projRoot);
    });

    describe('Primary as source', () => {
      test('Associated models included in query and mutation response with one sort key', async () => {
        await testPrimaryCpkSkOneContainsAssociated(currentId, apiEndpoint, apiKey);
      });

      test('Associated models included in query and mutation response with two sort keys', async () => {
        await testPrimaryCpkSkTwoContainAssociated(currentId, apiEndpoint, apiKey);
      });
    });

    describe('RelatedOne as source', () => {
      test('Associated models included in query and mutation response with one sort key', async () => {
        await testRelatedOneCpkSkOneContainsAssociated(currentId, apiEndpoint, apiKey);
      });

      test('Associated models included in query and mutation response with two sort keys', async () => {
        await testRelatedOneCpkSkTwoContainsAssociated(currentId, apiEndpoint, apiKey);
      });
    });

    describe('RelatedMany as source', () => {
      test('Associated models included in query and mutation response with one sort key', async () => {
        await testRelatedManyCpkSkOneContainsAssociated(currentId, apiEndpoint, apiKey);
      });

      test('Associated models included in query and mutation response with two sort keys', async () => {
        await testRelatedManypkSkTwoContainsAssociated(currentId, apiEndpoint, apiKey);
      });
    });
  });
});
