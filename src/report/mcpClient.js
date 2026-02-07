/**
 * MCP (Model Context Protocol) Client
 * 
 * This module provides integration with MCP servers for automating actions.
 * MCP allows AI assistants to interact with external tools and services.
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mcpClient = null;
let mcpSDKLoaded = false;
let ClientClass = null;
let StdioClientTransportClass = null;

/**
 * Lazy load MCP SDK
 */
async function loadMCPSDK() {
  if (mcpSDKLoaded) {
    return ClientClass !== null && StdioClientTransportClass !== null;
  }
  
  try {
    const mcpSDK = await import("@modelcontextprotocol/sdk/client/index.js");
    const transportSDK = await import("@modelcontextprotocol/sdk/client/stdio.js");
    ClientClass = mcpSDK.Client;
    StdioClientTransportClass = transportSDK.StdioClientTransport;
    mcpSDKLoaded = true;
    return true;
  } catch (error) {
    console.warn("MCP SDK not available. MCP features will be disabled. Install with: npm install @modelcontextprotocol/sdk");
    ClientClass = null;
    StdioClientTransportClass = null;
    mcpSDKLoaded = true;
    return false;
  }
}

/**
 * Initialize MCP client connection
 */
async function getMCPClient() {
  const sdkAvailable = await loadMCPSDK();
  
  if (!sdkAvailable) {
    throw new Error("MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk");
  }
  
  if (mcpClient) {
    return mcpClient;
  }

  const mcpServerPath = join(__dirname, "../services/automation/gcpMcpServer.js");

  // Create client transport
  const transport = new StdioClientTransportClass({
    command: "node",
    args: [mcpServerPath]
  });

  mcpClient = new ClientClass(
    {
      name: "slack-rag-bot-mcp-client",
      version: "1.0.0"
    },
    {
      capabilities: {}
    }
  );

  await mcpClient.connect(transport);
  
  return mcpClient;
}

/**
 * Execute MCP action by calling the MCP server tools
 * This is the legacy function for instance recreation - kept for backward compatibility
 */
export async function executeMCPAction(action, parsed) {
  // Check if MCP is enabled
  if (process.env.ENABLE_MCP !== "true") {
    throw new Error("MCP is not enabled. Set ENABLE_MCP=true to enable.");
  }

  try {
    const instanceName = parsed.instance_name;
    const projectId = parsed.project_id;
    
    if (!instanceName) {
      throw new Error("Instance name is required for MCP action");
    }

    const client = await getMCPClient();

    // First, discover instance metadata
    const metadataResult = await client.callTool({
      name: "discover_instance_metadata",
      arguments: { instanceName }
    });

    if (metadataResult.isError || !metadataResult.content || metadataResult.content.length === 0) {
      throw new Error(`Failed to discover instance metadata: ${metadataResult.content?.[0]?.text || "Unknown error"}`);
    }

    const metadataText = metadataResult.content[0].text;
    const metadata = JSON.parse(metadataText);
    if (metadata.error) {
      throw new Error(`Failed to discover instance metadata: ${metadata.error}`);
    }

    const { zone, migName, projectId: discoveredProjectId } = metadata;
    const finalProjectId = projectId || discoveredProjectId;

    // Execute the recreate instance action
    const executeResult = await client.callTool({
      name: "execute_recreate_instance",
      arguments: {
        projectId: finalProjectId,
        zone,
        migName,
        instanceName
      }
    });

    if (executeResult.isError || !executeResult.content || executeResult.content.length === 0) {
      throw new Error(`MCP execution failed: ${executeResult.content?.[0]?.text || "Unknown error"}`);
    }

    const executionResultText = executeResult.content[0].text;
    const executionResult = JSON.parse(executionResultText);
    
    return {
      success: executionResult.success !== false && !executionResult.error,
      result: executionResult,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Execute a gcloud command from an action template via MCP
 * This is the new function for executing arbitrary gcloud commands
 * 
 * @param {string} gcloudCommand - The full gcloud command to execute (from action_template)
 * @returns {Promise<Object>} - Execution result with success status and output
 */
export async function executeMCPGcloudCommand(gcloudCommand) {
  // Check if MCP is enabled
  if (process.env.ENABLE_MCP !== "true") {
    throw new Error("MCP is not enabled. Set ENABLE_MCP=true to enable.");
  }

  if (!gcloudCommand || !gcloudCommand.trim()) {
    throw new Error("gcloud command is required");
  }

  try {
    const client = await getMCPClient();

    // Execute the gcloud command via MCP
    const executeResult = await client.callTool({
      name: "execute_gcloud_command",
      arguments: {
        command: gcloudCommand.trim()
      }
    });

    if (executeResult.isError || !executeResult.content || executeResult.content.length === 0) {
      throw new Error(`MCP execution failed: ${executeResult.content?.[0]?.text || "Unknown error"}`);
    }

    const executionResultText = executeResult.content[0].text;
    const executionResult = JSON.parse(executionResultText);
    
    return {
      success: executionResult.success !== false && !executionResult.error,
      result: executionResult,
      command: executionResult.command || gcloudCommand,
      output: executionResult.stdout || executionResult.stderr || "",
      error: executionResult.error || null,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      command: gcloudCommand,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Execute GCP scale-up command via MCP
 * 
 * @param {Object} params - Parameters for scale-up
 * @param {string} params.serviceName - Service name (optional, for logging)
 * @param {string} params.gcloudCommand - The exact gcloud command from policy to execute
 * @returns {Promise<Object>} - Result with command and execution status
 */
export async function executeGcloudScaleUp(params) {
  // Check if MCP is enabled
  if (process.env.ENABLE_MCP !== "true") {
    throw new Error("MCP is not enabled. Set ENABLE_MCP=true to enable.");
  }

  if (!params.gcloudCommand || !params.gcloudCommand.trim()) {
    throw new Error("gcloud command is required");
  }

  try {
    const client = await getMCPClient();

    // Call the MCP tool to execute scale-up
    const result = await client.callTool({
      name: "execute_gcloud_scale_up",
      arguments: {
        serviceName: params.serviceName || null,
        gcloudCommand: params.gcloudCommand.trim()
      }
    });

    if (result.isError || !result.content || result.content.length === 0) {
      throw new Error(`MCP execution failed: ${result.content?.[0]?.text || "Unknown error"}`);
    }

    const resultText = result.content[0].text;
    const executionResult = JSON.parse(resultText);

    return {
      success: executionResult.success !== false && !executionResult.error,
      command: executionResult.command || null,
      message: executionResult.message || null,
      note: executionResult.note || null,
      error: executionResult.error || null,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Generate terragrunt autoscaler configuration diff via MCP
 * 
 * @param {Object} params - Parameters for autoscaler generation
 * @param {string} params.serviceName - Service name (e.g., 'api', 'gacha-api')
 * @param {string} params.scheduleName - Schedule name (e.g., 'mm-comp-7-star')
 * @param {string} params.scheduleExpression - Schedule expression
 * @param {string} params.durationSec - Duration variable (e.g., 'local.sch_02_hours')
 * @param {string} params.minReplicas - Min replicas variable (e.g., 'local.sch_moderate_high')
 * @param {string} params.timeZone - Time zone (default: 'Etc/UTC')
 * @returns {Promise<Object>} - Result with diff and autoscaler block
 */
export async function generateTerragruntAutoscalerDiff(params) {
  // Check if MCP is enabled
  if (process.env.ENABLE_MCP !== "true") {
    throw new Error("MCP is not enabled. Set ENABLE_MCP=true to enable.");
  }

  const { serviceName, scheduleName, scheduleExpression, durationSec, minReplicas, timeZone = "Etc/UTC" } = params;

  if (!serviceName || !scheduleName || !scheduleExpression || !durationSec || !minReplicas) {
    throw new Error("Missing required parameters: serviceName, scheduleName, scheduleExpression, durationSec, minReplicas");
  }

  try {
    const client = await getMCPClient();

    // Call the MCP tool to generate the diff
    const result = await client.callTool({
      name: "generate_terragrunt_autoscaler_diff",
      arguments: {
        serviceName,
        scheduleName,
        scheduleExpression,
        durationSec,
        minReplicas,
        timeZone
      }
    });

    if (result.isError || !result.content || result.content.length === 0) {
      throw new Error(`MCP execution failed: ${result.content?.[0]?.text || "Unknown error"}`);
    }

    const resultText = result.content[0].text;
    const executionResult = JSON.parse(resultText);
    
    return {
      success: executionResult.success !== false && !executionResult.error,
      result: executionResult,
      diff: executionResult.diff || "",
      autoscalerBlock: executionResult.autoscalerBlock || "",
      error: executionResult.error || null,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Generate terragrunt machine type change diff via MCP
 * 
 * @param {Object} params - Parameters for machine type diff generation
 * @param {string} params.environment - Environment name (e.g., 'qaprod', 'production')
 * @param {string} params.serviceName - Service name (e.g., 'matchmakerd_drb')
 * @param {string} params.currentMachineType - Current machine type (e.g., 'c2d-standard-2')
 * @param {string} params.targetMachineType - Target machine type (e.g., 'c2d-standard-4')
 * @returns {Promise<Object>} - Result with diff
 */
export async function generateMachineTypeDiff(params) {
  // Check if MCP is enabled
  if (process.env.ENABLE_MCP !== "true") {
    throw new Error("MCP is not enabled. Set ENABLE_MCP=true to enable.");
  }

  const { environment, serviceName, currentMachineType, targetMachineType } = params;

  if (!environment || !serviceName || !currentMachineType || !targetMachineType) {
    throw new Error("Missing required parameters: environment, serviceName, currentMachineType, targetMachineType");
  }

  try {
    const client = await getMCPClient();

    // Call the MCP tool to generate the diff
    const result = await client.callTool({
      name: "generate_machine_type_diff",
      arguments: {
        environment,
        serviceName,
        currentMachineType,
        targetMachineType
      }
    });

    if (result.isError || !result.content || result.content.length === 0) {
      throw new Error(`MCP execution failed: ${result.content?.[0]?.text || "Unknown error"}`);
    }

    const resultText = result.content[0].text;
    const executionResult = JSON.parse(resultText);
    
    return {
      success: executionResult.success !== false && !executionResult.error,
      result: executionResult,
      diff: executionResult.diff || "",
      error: executionResult.error || null,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Alternative: Direct command execution via MCP tools
 * This would use MCP SDK if available
 */
export async function executeMCPCommand(command, args = {}) {
  // This is a placeholder for MCP SDK integration
  // Example: Using @modelcontextprotocol/sdk if available
  // 
  // const client = new MCPClient({ serverUrl: process.env.MCP_SERVER_URL });
  // return await client.callTool("execute_command", { command, args });
  
  throw new Error("MCP SDK integration not yet implemented. Use executeMCPAction instead.");
}

