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

  // MCP SDK uses a whitelist of env vars by default (HOME, PATH, etc.) - GITHUB_TOKEN is excluded.
  // Pass full process.env so the MCP server (gcpMcpServer) receives GITHUB_TOKEN, ENABLE_MCP, etc.
  const env = { ...process.env };

  // Create client transport
  const transport = new StdioClientTransportClass({
    command: "node",
    args: [mcpServerPath],
    env
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
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [MCP Client] executeGcloudScaleUp called`);
    console.log(`[${timestamp}] [MCP Client] Parameters:`, JSON.stringify(params, null, 2));
    
    const client = await getMCPClient();

    // Call the MCP tool to execute scale-up
    console.log(`[${timestamp}] [MCP Client] Calling MCP tool: execute_gcloud_scale_up`);
    const result = await client.callTool({
      name: "execute_gcloud_scale_up",
      arguments: {
        serviceName: params.serviceName || null,
        gcloudCommand: params.gcloudCommand.trim()
      }
    });
    
    console.log(`[${timestamp}] [MCP Client] MCP tool call completed. isError: ${result.isError}`);

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
 * Generate scaling schedule YAML diff via MCP from SCALEPRREQUEST format
 * 
 * @param {Object} params - Parameters for YAML diff generation
 * @param {string} params.schedule - Schedule in format "mm hh dd MM * YYYY" (e.g., "30 17 4 02 * 2026")
 * @param {number} params.duration - Duration in seconds (e.g., 7200)
 * @param {string} params.name - Scale up name (e.g., "big sale")
 * @returns {Promise<Object>} - Result with diff
 */
export async function generateScalingScheduleYamlDiff(params) {
  // Check if MCP is enabled
  if (process.env.ENABLE_MCP !== "true") {
    throw new Error("MCP is not enabled. Set ENABLE_MCP=true to enable.");
  }

  const { schedule, duration, name } = params;

  if (!schedule || !duration || !name) {
    throw new Error("Missing required parameters: schedule, duration, name");
  }

  try {
    const client = await getMCPClient();

    // Call the MCP tool to generate the YAML diff
    const result = await client.callTool({
      name: "generate_scaling_schedule_yaml_diff",
      arguments: {
        schedule,
        duration,
        name
      }
    });

    if (result.isError || !result.content || result.content.length === 0) {
      const errorText = result.content?.[0]?.text || "Unknown error";
      let errorDetails = errorText;
      try {
        const errorObj = JSON.parse(errorText);
        errorDetails = errorObj.error || errorText;
        if (errorObj.stderr) errorDetails += `\n\nStderr: ${errorObj.stderr}`;
        if (errorObj.stdout) errorDetails += `\n\nStdout: ${errorObj.stdout}`;
      } catch (e) {
        // Not JSON, use as-is
      }
      throw new Error(`MCP execution failed: ${errorDetails}`);
    }

    const resultText = result.content[0].text;
    const executionResult = JSON.parse(resultText);

    if (executionResult.error) {
      // Include stderr and stdout in error message for debugging
      const errorMsg = executionResult.error;
      const stderr = executionResult.stderr ? `\n\nStderr: ${executionResult.stderr}` : '';
      const stdout = executionResult.stdout ? `\n\nStdout: ${executionResult.stdout}` : '';
      throw new Error(`${errorMsg}${stderr}${stdout}`);
    }

    // Handle new response format (script execution returns output)
    if (executionResult.output) {
      return {
        success: true,
        ticketNumber: executionResult.ticketNumber,
        schedule: executionResult.schedule,
        duration: executionResult.duration,
        output: executionResult.output,
        message: executionResult.message || "Script execution completed"
      };
    }

    // Handle old response format (diff generation) for backward compatibility
    return {
      success: true,
      diff: executionResult.diff,
      yamlContent: executionResult.yamlContent,
      serviceName: executionResult.serviceName,
      scheduleName: executionResult.scheduleName,
      message: executionResult.message || "YAML diff generated successfully"
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
 * Create scaling schedule PR via GitHub API (MCP tool create_scaling_schedule_pr)
 *
 * @param {Object} params
 * @param {string} params.schedule - Schedule "mm hh dd MM * YYYY" (e.g. "30 17 4 02 * 2026")
 * @param {number} params.duration - Duration in seconds (e.g. 7200)
 * @param {string} params.name - Scale up name (e.g. "big sale")
 * @param {string} [params.owner] - GitHub repo owner (default: GITHUB_REPO_OWNER env)
 * @param {string} [params.repo] - GitHub repo name (default: GITHUB_REPO_NAME env)
 * @returns {Promise<Object>} - Result with prUrl, prNumber, etc.
 */
export async function createScalingSchedulePR(params) {
  if (process.env.ENABLE_MCP !== "true") {
    throw new Error("MCP is not enabled. Set ENABLE_MCP=true to enable.");
  }

  const { schedule, duration, name, owner, repo } = params;

  if (!schedule || !duration || !name) {
    throw new Error("Missing required parameters: schedule, duration, name");
  }
  if (!owner || !repo) {
    throw new Error("Missing owner/repo. Policy must include github_owner and github_repo.");
  }

  try {
    const client = await getMCPClient();
    const result = await client.callTool({
      name: "create_scaling_schedule_pr",
      arguments: {
        schedule,
        duration: typeof duration === "string" ? parseInt(duration, 10) : duration,
        name,
        owner,
        repo
      }
    });

    if (result.isError || !result.content || result.content.length === 0) {
      const errorText = result.content?.[0]?.text || "Unknown error";
      let errorDetails = errorText;
      try {
        const errorObj = JSON.parse(errorText);
        errorDetails = errorObj.error || errorText;
        if (errorObj.details) errorDetails += `\n${JSON.stringify(errorObj.details)}`;
      } catch (e) {
        // Not JSON, use as-is
      }
      throw new Error(`MCP execution failed: ${errorDetails}`);
    }

    const resultText = result.content[0].text;
    const executionResult = JSON.parse(resultText);

    if (executionResult.error) {
      throw new Error(executionResult.error);
    }

    return {
      success: true,
      ticketNumber: executionResult.ticketNumber,
      schedule: executionResult.schedule,
      duration: executionResult.duration,
      prUrl: executionResult.prUrl,
      prNumber: executionResult.prNumber,
      message: executionResult.message || "PR created"
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
  
  throw new Error("MCP SDK integration not yet implemented.");
}

