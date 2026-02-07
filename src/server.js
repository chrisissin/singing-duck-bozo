import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { parseAlert } from "./parser/parserEngine.js";
import { decide } from "./decision/decide.js";
import { formatReport } from "./report/formatReport.js";

const app = express();
app.use(express.json());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/", express.static(path.join(__dirname, "web")));

app.post("/api/analyze", async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "Missing 'text' field in request body" });
    }
    
    // Parse alert using the new parser engine
    const parseResult = await parseAlert(text);
    
    if (!parseResult.matched) {
      return res.status(400).json({ 
        error: "Could not parse alert",
        details: parseResult.error || "No matching policy or LLM parsing failed"
      });
    }
    
    // Make decision
    const decision = decide(parseResult.parsed, parseResult.policy);
    
    // Format report with MCP integration
    const report = await formatReport({ 
      parsed: parseResult.parsed, 
      decision, 
      policy: parseResult.policy 
    });
    
    res.json(report);
  } catch (error) {
    console.error("Error processing alert:", error);
    res.status(500).json({ 
      error: "Internal server error", 
      message: error.message 
    });
  }
});

app.listen(3000, () => console.log("Running on http://localhost:3000"));
