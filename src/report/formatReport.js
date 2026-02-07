import { executeMCPAction, generateTerragruntAutoscalerDiff, generateMachineTypeDiff } from "./mcpClient.js";

async function formatActionTemplate(template, parsed, originalText = null, isGitPR = false, gcloudCommandTemplate = null) {
  if (!template) {
    return null;
  }
  
  // Check if this is an MCP action template
  if (template.startsWith("MCP:")) {
    const mcpTool = template.substring(4); // Remove "MCP:" prefix
    
    // For git PR option, return "under development" message
    if (isGitPR && mcpTool === "generate_terragrunt_autoscaler_diff") {
      return "🚧 *Under Development*\n\nGit PR scaling option is currently under development. This feature will allow you to create a pull request with terragrunt autoscaler configuration changes.";
    }
    
    if (mcpTool === "execute_gcloud_scale_up") {
      // For GCP command scale-up, use the command directly from policy
      const { executeGcloudScaleUp } = await import("./mcpClient.js");
      try {
        if (!gcloudCommandTemplate) {
          return `*GCP Scale-Up Command:*\n\n❌ No gcloud command template found in policy. Please add \`gcloud_command_template\` to the action template.`;
        }
        
        // Pass the exact command from policy (no template replacement)
        const result = await executeGcloudScaleUp({
          serviceName: parsed.service_name || parsed.serviceName || null,
          gcloudCommand: gcloudCommandTemplate
        });
        if (result.success) {
          return `*GCP Scale-Up Command:*\n\`\`\`\n${result.command || gcloudCommandTemplate}\n\`\`\`\n\n${result.message || 'Ready to execute'}`;
        } else {
          return `Failed to prepare scale-up command: ${result.error || "Unknown error"}`;
        }
      } catch (error) {
        return `Error preparing scale-up command: ${error.message}`;
      }
    }
    
    if (mcpTool === "generate_terragrunt_autoscaler_diff") {
      // Extract parameters from parsed data or use defaults
      const params = {
        serviceName: parsed.service_name || parsed.serviceName || "api",
        scheduleName: parsed.schedule_name || parsed.scheduleName || `scale-up-${Date.now()}`,
        scheduleExpression: parsed.schedule_expression || parsed.scheduleExpression || "s(local.sch_1730_utc) 12 $(local.sch_jan_2026)",
        durationSec: parsed.duration_sec || parsed.durationSec || "local.sch_02_hours",
        minReplicas: parsed.min_replicas || parsed.minReplicas || "local.sch_moderate_high",
        timeZone: parsed.time_zone || parsed.timeZone || "Etc/UTC"
      };
      
      try {
        const result = await generateTerragruntAutoscalerDiff(params);
        if (result.success && result.diff) {
          return `Generated terragrunt autoscaler configuration diff:\n\n\`\`\`diff\n${result.diff}\`\`\``;
        } else {
          return `Failed to generate autoscaler diff: ${result.error || "Unknown error"}`;
        }
      } catch (error) {
        return `Error generating autoscaler diff: ${error.message}`;
      }
    }
    
    if (mcpTool === "generate_machine_type_diff") {
      // Extract parameters from parsed data or use defaults
      let serviceName = parsed.service_name || parsed.serviceName || null;
      
      // Normalize service name: if it's in format like "mcoc-qaprod-mmakerd-drb", try to extract the service part
      // Pattern: {project}-{env}-{service-parts} -> extract {service-parts} and convert dashes to underscores
      if (serviceName && serviceName.includes('-')) {
        const parts = serviceName.split('-');
        // If it looks like "mcoc-qaprod-mmakerd-drb" (3+ parts), extract service part
        // Common patterns: "mcoc-qaprod-matchmakerd-drb" -> "matchmakerd_drb"
        //                  "mcoc-qaprod-mmakerd-drb" -> "mmakerd_drb" (might need manual fix)
        if (parts.length >= 3) {
          // Take the service parts (everything after project-env) and convert dashes to underscores
          const serviceParts = parts.slice(2).join('-');
          serviceName = serviceParts.replace(/-/g, '_');
        } else if (parts.length === 2) {
          // If it's just two parts, might be "env-service", take the service part
          serviceName = parts[1].replace(/-/g, '_');
        }
        // If it's a single part or already normalized, keep as-is
      }
      
      const params = {
        environment: parsed.environment || parsed.env || "qaprod",
        serviceName: serviceName,
        currentMachineType: parsed.current_machine_type || parsed.currentMachineType || null,
        targetMachineType: parsed.target_machine_type || parsed.targetMachineType || null
      };
      
      // Validate required parameters
      if (!params.serviceName || !params.currentMachineType || !params.targetMachineType) {
        return `Missing required parameters for machine type change. Need: service_name, current_machine_type, target_machine_type. Current values: ${JSON.stringify(params)}`;
      }
      
      try {
        const result = await generateMachineTypeDiff(params);
        if (result.success && result.diff) {
          return `Generated machine type change diff:\n\n\`\`\`diff\n${result.diff}\`\`\``;
        } else {
          return `Failed to generate machine type diff: ${result.error || "Unknown error"}`;
        }
      } catch (error) {
        return `Error generating machine type diff: ${error.message}`;
      }
    }
    
    // For other MCP tools, return the tool name for now
    return `MCP tool: ${mcpTool}`;
  }
  
  // Regular template replacement
  let action = template;
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== null && value !== undefined) {
      action = action.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
    }
  }
  return action;
}

function formatSummaryTemplate(template, actionOptions, parsed) {
  if (!template) {
    return actionOptions || "No action template available";
  }
  
  let summary = template.replace("{action_options}", actionOptions || "No actions available");
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== null && value !== undefined) {
      summary = summary.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
    }
  }
  // Also support legacy {action} for backward compatibility
  if (template.includes("{action}") && actionOptions) {
    summary = summary.replace("{action}", actionOptions);
  }
  return summary;
}

export async function formatReport({ parsed, decision, policy = null, originalText = null }) {
  let action = null;
  let actionOptions = null;
  const actionList = [];
  
  // Handle multiple action templates (new format)
  if (policy?.action_templates && Array.isArray(policy.action_templates)) {
    for (const actionTemplate of policy.action_templates) {
      // Check if this is the git PR option (for scaling intent detection)
      // It's the git PR option if the label mentions "git pr" or if it uses terragrunt_autoscaler_diff for scaling
      const isGitPR = policy.alert_type === "scaling_intent_detected" && 
                     (actionTemplate.label?.toLowerCase().includes("git pr") || 
                      (actionTemplate.template?.includes("terragrunt_autoscaler_diff") && 
                       !actionTemplate.template?.includes("execute_gcloud")));
      const formattedAction = await formatActionTemplate(
        actionTemplate.template, 
        parsed, 
        originalText,
        isGitPR,
        actionTemplate.gcloud_command_template || null
      );
      
      if (formattedAction) {
        actionList.push({
          label: actionTemplate.label || "Action",
          description: actionTemplate.description || "",
          template: actionTemplate.template,
          gcloudCommandTemplate: actionTemplate.gcloud_command_template || null,
          action: formattedAction
        });
      }
    }
    
    // Format action options for summary
    if (actionList.length > 0) {
      actionOptions = actionList.map((opt, idx) => {
        return `*Option ${idx + 1}: ${opt.label}*\n${opt.description ? `${opt.description}\n` : ''}${opt.action}`;
      }).join('\n\n');
    }
    
    // For backward compatibility, set action to first option or combined
    action = actionOptions || actionList[0]?.action || null;
  } 
  // Handle single action template (legacy format)
  else if (policy?.action_template) {
    action = await formatActionTemplate(policy.action_template, parsed, originalText);
    actionOptions = action;
  }
  
  const summary = policy?.summary_template
    ? formatSummaryTemplate(policy.summary_template, actionOptions || action, parsed)
    : (actionOptions || action || "Approval required");
  
  const report = {
    parsed,
    decision,
    action,
    actionOptions: actionList.length > 0 ? actionList : null, // Array of action options
    summary,
    mcp_executed: false,
    mcp_result: null
  };
  
  // Execute MCP action if decision is AUTO_REPLACE and MCP is enabled
  // if (decision.decision === "AUTO_REPLACE" && action && process.env.ENABLE_MCP === "true") {
  //   try {
  //     const mcpResult = await executeMCPAction(action, parsed);
  //     report.mcp_executed = true;
  //     report.mcp_result = mcpResult;
  //   } catch (error) {
  //     report.mcp_executed = false;
  //     report.mcp_error = error.message;
  //   }
  // }
  
  return report;
}
