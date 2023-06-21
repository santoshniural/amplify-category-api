import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as cfninclude from 'aws-cdk-lib/cloudformation-include';
import { executeTransform } from '@aws-amplify/graphql-transformer';
import {
  convertAuthorizationModesToTransformerAuthConfig,
  preprocessGraphqlSchema,
  generateConstructExports,
  rewriteAndPersistAssets,
  defaultTransformParameters,
  convertToResolverConfig,
} from './internal';
import type { AmplifyGraphqlApiResources, AmplifyGraphqlApiProps, FunctionSlot } from './types';
import { parseUserDefinedSlots } from './internal/user-defined-slots';

/**
 * L3 Construct which invokes the Amplify Transformer Pattern over an input GraphQL Schema.
 *
 * This can be used to quickly define appsync apis which support full CRUD+List and Subscriptions, relationships,
 * auth, search over data, the ability to inject custom business logic and query/mutation operations, and connect to ML services.
 *
 * For more information, refer to the docs links below:
 * Data Modeling - https://docs.amplify.aws/cli/graphql/data-modeling/
 * Authorization - https://docs.amplify.aws/cli/graphql/authorization-rules/
 * Custom Business Logic - https://docs.amplify.aws/cli/graphql/custom-business-logic/
 * Search - https://docs.amplify.aws/cli/graphql/search-and-result-aggregations/
 * ML Services - https://docs.amplify.aws/cli/graphql/connect-to-machine-learning-services/
 *
 * For a full reference of the supported custom graphql directives - https://docs.amplify.aws/cli/graphql/directives-reference/
 *
 * The output of this construct is a mapping of L1 resources generated by the transformer, which generally follow the access pattern
 *
 * ```typescript
 *   const api = new AmplifyGraphQlApi(this, 'api', { <params> });
 *   api.resources.api.xrayEnabled = true;
 *   Object.values(api.resources.tables).forEach(table => table.pointInTimeRecoverySpecification = { pointInTimeRecoveryEnabled: false });
 * ```
 * `resources.<ResourceType>.<ResourceName>` - you can then perform any CDK action on these resulting resoureces.
 */
export class AmplifyGraphqlApi extends Construct {
  /**
   * Generated resources.
   */
  public readonly resources: AmplifyGraphqlApiResources;

  /**
   * Resolvers generated by the transform process, persisted on the side in order to facilitate pulling a manifest
   * for the purposes of inspecting and producing overrides.
   */
  private readonly transformerGeneratedResolvers: Record<string, string>;

  constructor(scope: Construct, id: string, props: AmplifyGraphqlApiProps) {
    super(scope, id);

    const {
      schema: modelSchema,
      authorizationConfig,
      conflictResolution,
      functionSlots,
      transformers,
      predictionsBucket,
      stackMappings,
      transformParameters: overriddenTransformParameters,
    } = props;

    const {
      authConfig,
      identityPoolId,
      adminRoles,
      cfnIncludeParameters: authCfnIncludeParameters,
    } = convertAuthorizationModesToTransformerAuthConfig(authorizationConfig);

    const transformedResources = executeTransform({
      schema: preprocessGraphqlSchema(modelSchema),
      userDefinedSlots: functionSlots ? parseUserDefinedSlots(functionSlots) : {},
      transformersFactoryArgs: {
        authConfig,
        identityPoolId,
        adminRoles,
        customTransformers: transformers ?? [],
        ...(predictionsBucket ? { storageConfig: { bucketName: predictionsBucket.bucketName } } : {}),
      },
      authConfig,
      stackMapping: stackMappings ?? {},
      resolverConfig: conflictResolution ? convertToResolverConfig(conflictResolution) : undefined,
      transformParameters: {
        ...defaultTransformParameters,
        ...(overriddenTransformParameters ?? {}),
      },
    });

    // Persist for the purposes of manifest generation.
    this.transformerGeneratedResolvers = transformedResources.resolvers;

    const stackAssets = rewriteAndPersistAssets(this, {
      schema: transformedResources.schema,
      resolvers: transformedResources.resolvers,
      functions: transformedResources.functions,
      rootStack: transformedResources.rootStack,
      stacks: transformedResources.stacks,
    });

    // Allow env as an override prop, otherwise retrieve from context, and use value 'NONE' if no value can be found.
    // env is required for logical id suffixing, as well as Exports from the nested stacks.
    // Allow export so customers can reuse the env in their own references downstream.
    const env = this.node.tryGetContext('env') ?? 'NONE';
    if (env.length > 8) {
      throw new Error(`or cdk --context env must have a length <= 8, found ${env}`);
    }

    const transformerStack = new cfninclude.CfnInclude(this, 'RootStack', {
      ...stackAssets,
      parameters: {
        AppSyncApiName: props.apiName ?? id,
        env,
        S3DeploymentBucket: cdk.DefaultStackSynthesizer.DEFAULT_FILE_ASSETS_BUCKET_NAME,
        S3DeploymentRootKey: cdk.DefaultStackSynthesizer.DEFAULT_FILE_ASSET_KEY_ARN_EXPORT_NAME,
        ...authCfnIncludeParameters,
      },
      preserveLogicalIds: true,
    });

    this.resources = generateConstructExports(transformedResources.rootStack, transformedResources.stacks, transformerStack);
  }

  /**
   * Get the function slots generated by the GraphQL transform operation, adhering to the FunctionSlot interface.
   * @returns the list of generated function slots in the transformer, in order to facilitate overrides.
   */
  getGeneratedFunctionSlots(): FunctionSlot[] {
    return Object.entries(this.transformerGeneratedResolvers)
      .filter(([name]) => name.split('.').length === 6)
      .map(([name, resolverCode]) => {
        const [typeName, fieldName, slotName, slotIndex, templateType] = name.split('.');
        return {
          typeName,
          fieldName,
          slotName,
          slotIndex: Number.parseInt(slotIndex, 10),
          templateType,
          resolverCode,
        } as FunctionSlot;
      });
  }
}
