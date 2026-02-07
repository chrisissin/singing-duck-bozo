import { z } from "zod";

export const ParsedAlertSchema = z.object({
  alert_type: z.string(),
  project_id: z.string().nullable(),
  instance_name: z.string().nullable(),
  metric_labels: z.record(z.string()),
  threshold_percent: z.number().nullable().optional(),
  value_percent: z.number().nullable().optional(),
  policy_name: z.string().nullable(),
  condition_name: z.string().nullable(),
  violation_started_raw: z.string().nullable(),
  gcp_alert_url: z.string().nullable(),
  confidence: z.number(),
  missing_fields: z.array(z.string()),
  parse_method: z.string(),
  // Optional fields for scaling intent detection
  user_intent: z.string().nullable().optional(),
  service_name: z.string().nullable().optional(),
  schedule_name: z.string().nullable().optional(),
  schedule_expression: z.string().nullable().optional(),
  duration_sec: z.string().nullable().optional(),
  min_replicas: z.string().nullable().optional(),
  // Optional fields for add memory to VM
  environment: z.string().nullable().optional(),
  current_machine_type: z.string().nullable().optional(),
  target_machine_type: z.string().nullable().optional()
}).passthrough(); // Allow additional fields

// Keep backward compatibility
export const ParsedDiskAlertSchema = ParsedAlertSchema.extend({
  alert_type: z.literal("disk_utilization_low")
});

export function validateParsedAlert(o) {
  return ParsedAlertSchema.parse(o);
}

export function validateParsedDiskAlert(o) {
  return ParsedDiskAlertSchema.parse(o);
}
