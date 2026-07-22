import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

let client: DynamoDBDocumentClient | null = null

/**
 * NASで共有するDynamoDB DocumentClient。
 * Vercelでは既存のAWS認証情報を使用し、ローカルでは環境変数またはAWS既定認証を使う。
 */
export function getDynamoClient(): DynamoDBDocumentClient {
  if (client) return client

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim()
  const region = process.env.AWS_REGION?.trim() || 'ap-northeast-1'

  const raw = new DynamoDBClient({
    region,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  })

  client = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true },
  })
  return client
}
