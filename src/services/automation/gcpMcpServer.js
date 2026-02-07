// src/services/automation/gcpMcpServer.js
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const server = new Server(
  { 
    name: "gcp-autoheal", 
    version: "1.0.0" 
  }, 
  { 
    capabilities: { 
      tools: {} 
    } 
  }
);

/**
 * TOOL 1: DISCOVERY
 * Finds the Zone and Instance Group (MIG) for a given instance name.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "discover_instance_metadata",
        description: "Finds the project, zone, and MIG name for a specific instance",
        inputSchema: {
          type: "object",
          properties: {
            instanceName: { type: "string", description: "Instance name to look up" }
          },
          required: ["instanceName"]
        }
      },
      {
        name: "execute_recreate_instance",
        description: "Recreates an instance in a Managed Instance Group",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "GCP project ID" },
            zone: { type: "string", description: "GCP zone" },
            migName: { type: "string", description: "Managed Instance Group name" },
            instanceName: { type: "string", description: "Instance name to recreate" }
          },
          required: ["projectId", "zone", "migName", "instanceName"]
        }
      },
      {
        name: "execute_gcloud_command",
        description: "Executes an arbitrary gcloud command. Use this for executing gcloud commands from action templates.",
        inputSchema: {
          type: "object",
          properties: {
            command: { 
              type: "string", 
              description: "The full gcloud command to execute (e.g., 'gcloud compute ssh instance-name --zone=us-central1-a --project=my-project --command=\"ls -la\"')" 
            }
          },
          required: ["command"]
        }
      },
      {
        name: "execute_gcloud_scale_up",
        description: "Executes a gcloud command to scale up instances. Uses the exact command from policy.",
        inputSchema: {
          type: "object",
          properties: {
            serviceName: {
              type: "string",
              description: "Service name to scale up (optional, used for logging)"
            },
            gcloudCommand: {
              type: "string",
              description: "The exact gcloud command from policy to execute (no template replacement needed)"
            }
          },
          required: ["gcloudCommand"]
        }
      },
      {
        name: "generate_terragrunt_autoscaler_diff",
        description: "Generates a terragrunt.hcl autoscaler configuration diff for scaling up servers. Takes service name, schedule, and scaling parameters.",
        inputSchema: {
          type: "object",
          properties: {
            serviceName: { 
              type: "string", 
              description: "Name of the service (e.g., 'api', 'gacha-api', 'login-api')" 
            },
            scheduleName: { 
              type: "string", 
              description: "Name for the autoscaler schedule (e.g., 'mm-comp-7-star')" 
            },
            scheduleExpression: { 
              type: "string", 
              description: "Schedule expression (e.g., 's(local.sch_1730_utc) 12 $(local.sch_jan_2026)')" 
            },
            durationSec: { 
              type: "string", 
              description: "Duration in seconds variable (e.g., 'local.sch_02_hours')" 
            },
            minReplicas: { 
              type: "string", 
              description: "Minimum replicas variable (e.g., 'local.sch_moderate_high')" 
            },
            timeZone: { 
              type: "string", 
              description: "Time zone (default: 'Etc/UTC')" 
            }
          },
          required: ["serviceName", "scheduleName", "scheduleExpression", "durationSec", "minReplicas"]
        }
      },
      {
        name: "generate_machine_type_diff",
        description: "Generates a terragrunt.hcl diff for changing VM machine type (to add memory). Takes environment, service name, current and target machine types.",
        inputSchema: {
          type: "object",
          properties: {
            environment: { 
              type: "string", 
              description: "Environment name (e.g., 'qaprod', 'production')" 
            },
            serviceName: { 
              type: "string", 
              description: "Service name (e.g., 'matchmakerd_drb', 'api')" 
            },
            currentMachineType: { 
              type: "string", 
              description: "Current machine type (e.g., 'c2d-standard-2')" 
            },
            targetMachineType: { 
              type: "string", 
              description: "Target machine type (e.g., 'c2d-standard-4')" 
            }
          },
          required: ["environment", "serviceName", "currentMachineType", "targetMachineType"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "discover_instance_metadata") {
    try {
      const { instanceName } = args;
      
      // Use gcloud command to discover instance metadata
      const gcloudCmd = `gcloud compute instances describe ${instanceName} --format="json(zone,name)" --project=$(gcloud config get-value project 2>/dev/null || echo '')`;
      
      try {
        const { stdout } = await execAsync(gcloudCmd);
        const instanceInfo = JSON.parse(stdout);
        const zone = instanceInfo.zone ? instanceInfo.zone.split('/').pop() : 'unknown';
        
        // Try to get project ID from gcloud config
        const { stdout: projectId } = await execAsync('gcloud config get-value project 2>/dev/null || echo ""');
        
        // MIG name is harder to get via gcloud, so we'll return unknown for now
        const migName = "unknown";
        
        return {
          content: [{ type: "text", text: JSON.stringify({ zone, migName, projectId: projectId.trim() || null }) }]
        };
      } catch (gcloudErr) {
        // Fallback: return error
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Failed to discover instance: ${gcloudErr.message}. Make sure gcloud is configured and the instance exists.` }) }],
          isError: true
        };
      }
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
        isError: true
      };
    }
  }

  if (name === "execute_recreate_instance") {
    try {
      const { projectId, zone, migName, instanceName } = args;
      
      // Use gcloud command to recreate instance
      const gcloudCmd = `gcloud compute instance-groups managed recreate-instances ${migName} --instances=${instanceName} --zone=${zone}${projectId ? ` --project=${projectId}` : ''}`;
      
      try {
        const { stdout, stderr } = await execAsync(gcloudCmd);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, message: `Successfully triggered recreation for ${instanceName} in ${migName}`, output: stdout || stderr }) }]
        };
      } catch (gcloudErr) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `GCP Error: ${gcloudErr.message}`, stderr: gcloudErr.stderr || "" }) }],
          isError: true
        };
      }
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `GCP Error: ${err.message}` }) }],
        isError: true
      };
    }
  }

  if (name === "execute_gcloud_command") {
    try {
      const { command } = args;
      
      // Security: Only allow gcloud commands
      if (!command.trim().startsWith("gcloud")) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Only gcloud commands are allowed" }) }],
          isError: true
        };
      }

      // Execute the gcloud command
      console.log(`[MCP Server] Executing gcloud command: ${command}`);
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 300000 // 5 minute timeout
      });

      const output = stdout || stderr || "";
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            success: true, 
            command,
            stdout: output,
            message: `Command executed successfully` 
          }) 
        }]
      };
    } catch (err) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            error: `Command execution failed: ${err.message}`,
            stderr: err.stderr || "",
            stdout: err.stdout || ""
          }) 
        }],
        isError: true
      };
    }
  }

  if (name === "execute_gcloud_scale_up") {
    try {
      const { serviceName, gcloudCommand } = args;
      
      if (!gcloudCommand || !gcloudCommand.trim()) {
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({ 
              error: "gcloud command is required"
            }) 
          }],
          isError: true
        };
      }
      
      // Use the command directly from policy (no template replacement)
      const gcloudCmd = gcloudCommand.trim();
      
      console.log(`[MCP Server] Executing scale-up command for service: ${serviceName || 'unknown'}`);
      console.log(`[MCP Server] Command: ${gcloudCmd}`);
      
      // For now, return the command that would be executed
      // Uncomment the execAsync call below when you're ready to execute
      /*
      const { stdout, stderr } = await execAsync(gcloudCmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 300000
      });
      */
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            success: true, 
            command: gcloudCmd,
            message: `Scale-up command prepared and ready to execute.`
          }) 
        }]
      };
    } catch (err) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            error: `Scale-up command failed: ${err.message}`
          }) 
        }],
        isError: true
      };
    }
  }

  if (name === "generate_terragrunt_autoscaler_diff") {
    try {
      const { 
        serviceName, 
        scheduleName, 
        scheduleExpression, 
        durationSec, 
        minReplicas,
        timeZone = "Etc/UTC"
      } = args;

      // Generate the terragrunt.hcl autoscaler block (with proper indentation)
      const autoscalerBlock = `  autoscaler {
    name = "${scheduleName}"
    schedule = "${scheduleExpression}"
    duration_sec = ${durationSec}
    min_required_replicas = ${minReplicas}
    time_zone = "${timeZone}"
  }
  // Autoscaler`;

      // Generate git diff format similar to GitHub PR
      // The @@ line shows: @@ -old_start,old_count +new_start,new_count @@
      // We'll use a placeholder line number (283) as shown in the example
      const diff = `--- a/production/${serviceName}/terragrunt.hcl
+++ b/production/${serviceName}/terragrunt.hcl
@@ -283,6 +283,14 @@
+${autoscalerBlock}`;

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            success: true, 
            serviceName,
            diff,
            autoscalerBlock,
            message: `Generated terragrunt autoscaler configuration diff for ${serviceName}` 
          }) 
        }]
      };
    } catch (err) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            error: `Failed to generate diff: ${err.message}` 
          }) 
        }],
        isError: true
      };
    }
  }

  if (name === "generate_machine_type_diff") {
    try {
      const { 
        environment, 
        serviceName, 
        currentMachineType, 
        targetMachineType 
      } = args;

      // Generate the git diff format for machine type change
      // Based on the example: diff shows changing machine_type in instance_template
      const diff = `diff --git a/${environment}/${serviceName}/terragrunt.hcl b/${environment}/${serviceName}/terragrunt.hcl
index cce6ec39..d03993cc 100644
--- a/${environment}/${serviceName}/terragrunt.hcl
+++ b/${environment}/${serviceName}/terragrunt.hcl
@@ -90,7 +90,7 @@ inputs = merge(
     // Instance Template
     instance_template = {
       name         = local.tf_var_files.name
-      machine_type = "${currentMachineType}"
+      machine_type = "${targetMachineType}"
       tags         = local.tf_var_files.default_network_tags
       labels = {
         game        = local.tf_var_files.product`;

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            success: true, 
            environment,
            serviceName,
            currentMachineType,
            targetMachineType,
            diff,
            message: `Generated machine type change diff for ${environment}/${serviceName}` 
          }) 
        }]
      };
    } catch (err) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            error: `Failed to generate machine type diff: ${err.message}` 
          }) 
        }],
        isError: true
      };
    }
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
    isError: true
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
