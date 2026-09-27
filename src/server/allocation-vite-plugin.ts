// SUPERSEDED — kept only for reference, no longer registered in vite.config.ts.
//
// This plugin only ever worked under `vite dev` (Vite's `configureServer`
// hook is dev-server-only, never included in the production build), and it
// spawned `python3` to run scripts/lab_allocation.py. This app deploys to
// Cloudflare Workers, which has no Node child_process, filesystem, or Python
// runtime, so in production POST /api/allocation/run had no route to hit and
// the frontend got the SPA's index.html back instead of JSON.
//
// The pipeline has been ported to TypeScript in
// src/lib/lab-allocation-runner/ and now runs entirely client-side (same
// code path in dev and production, no server round-trip). See
// src/lib/allocation-client.ts for the new entry point. This file and
// scripts/lab_allocation.py are left in place as a reference for the
// original algorithm, but nothing imports them anymore.
import type { Plugin, ViteDevServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { IncomingMessage, ServerResponse } from "node:http";

interface RunRequestBody {
  studentFileBase64?: string;
  studentFileName?: string;
  labFileBase64?: string;
  labFileName?: string;
  dashboardFileBase64?: string;
  dashboardFileName?: string;
  program?: string;
  prefix?: string;
  useDbLabs?: boolean;
  labsJson?: Array<{ "Lab ID": string; Area: string; "Lab Capacity": number }>;
  preferences?: {
    overfillRules?: Array<{
      area: string;
      grades: number[];
      labIds: string[];
      maxOverfillPerLab?: number;
    }>;
    preferredLabRules?: Array<{
      area: string;
      grades: number[];
      labId: string;
      slotNum?: number;
    }>;
    extraLabs?: Array<{
      area: string;
      labId: string;
      capacity: number;
      slots?: number[];
    }>;
    customSlots?: string[];
  };
}

const JOBS_DIR = path.join(os.tmpdir(), "ischool_lab_allocation_jobs");
if (!fs.existsSync(JOBS_DIR)) {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        const parsed = JSON.parse(raw || "{}");
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function sendFile(res: ServerResponse, filePath: string, downloadName: string, mimeType = "application/octet-stream") {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("File not found");
    return;
  }
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Type": mimeType,
    "Content-Length": stat.size,
    "Content-Disposition": `attachment; filename="${encodeURIComponent(downloadName)}"`,
    "Access-Control-Allow-Origin": "*",
  });
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}

export function allocationApiPlugin(): Plugin {
  return {
    name: "vite-plugin-lab-allocation",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const pathname = url.pathname;

        // CORS preflight
        if (req.method === "OPTIONS" && pathname.startsWith("/api/allocation")) {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          res.end();
          return;
        }

        // Endpoint: POST /api/allocation/run
        if (pathname === "/api/allocation/run" && req.method === "POST") {
          try {
            const body = await parseJsonBody<RunRequestBody>(req);
            const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const jobDir = path.join(JOBS_DIR, jobId);
            const inputDir = path.join(jobDir, "inputs");
            const outputDir = path.join(jobDir, "output");
            fs.mkdirSync(inputDir, { recursive: true });
            fs.mkdirSync(outputDir, { recursive: true });

            // 1. Save student file
            if (!body.studentFileBase64) {
              sendJson(res, 400, { error: "Missing required student file." });
              return;
            }
            const studentFileName = body.studentFileName || "students.xlsx";
            const studentFilePath = path.join(inputDir, studentFileName);
            fs.writeFileSync(studentFilePath, Buffer.from(body.studentFileBase64, "base64"));

            // 2. Save lab file
            let labFilePath = "";
            if (body.useDbLabs && body.labsJson && body.labsJson.length > 0) {
              // Convert labsJson to CSV
              const labCsv = [
                "Lab ID,Area,Lab Capacity",
                ...body.labsJson.map(
                  (l) => `"${l["Lab ID"].replace(/"/g, '""')}","${l.Area.replace(/"/g, '""')}",${l["Lab Capacity"]}`
                ),
              ].join("\n");
              labFilePath = path.join(inputDir, "db_labs.csv");
              fs.writeFileSync(labFilePath, labCsv, "utf-8");
            } else if (body.labFileBase64) {
              const labFileName = body.labFileName || "labs.xlsx";
              labFilePath = path.join(inputDir, labFileName);
              fs.writeFileSync(labFilePath, Buffer.from(body.labFileBase64, "base64"));
            } else {
              sendJson(res, 400, { error: "Missing required lab file or database lab selection." });
              return;
            }

            // 3. Optional dashboard file
            let dashboardFilePath = "";
            if (body.dashboardFileBase64) {
              const dashName = body.dashboardFileName || "dashboard_template.xlsx";
              dashboardFilePath = path.join(inputDir, dashName);
              fs.writeFileSync(dashboardFilePath, Buffer.from(body.dashboardFileBase64, "base64"));
            }

            const prefix = body.prefix || (body.program === "DEMI" ? "Physical-DEMI-G" : "Physical-DS-G");

            // Build Python CLI command
            const scriptPath = path.resolve(process.cwd(), "scripts/lab_allocation.py");
            const args = [
              scriptPath,
              "--student",
              studentFilePath,
              "--lab",
              labFilePath,
              "--output-dir",
              outputDir,
              "--prefix",
              prefix,
              "--json",
            ];
            if (dashboardFilePath) {
              args.push("--dashboard", dashboardFilePath);
            }

            if (body.preferences) {
              const prefPath = path.join(inputDir, "preferences.json");
              fs.writeFileSync(prefPath, JSON.stringify(body.preferences, null, 2), "utf-8");
              args.push("--preferences", prefPath);
            }

            const pythonProcess = spawn("python3", args, {
              cwd: process.cwd(),
              env: { ...process.env },
            });

            let stdout = "";
            let stderr = "";

            pythonProcess.stdout.on("data", (data) => {
              stdout += data.toString();
            });

            pythonProcess.stderr.on("data", (data) => {
              stderr += data.toString();
            });

            pythonProcess.on("close", (code) => {
              if (code !== 0) {
                console.error("Python allocation error:", stderr, stdout);
                sendJson(res, 422, {
                  error: stderr || stdout || "Allocation pipeline failed.",
                  logs: [stderr, stdout].filter(Boolean),
                });
                return;
              }

              // Read result json
              const resultJsonPath = path.join(outputDir, "allocation_result.json");
              if (fs.existsSync(resultJsonPath)) {
                try {
                  const payload = JSON.parse(fs.readFileSync(resultJsonPath, "utf-8"));
                  payload.jobId = jobId;
                  sendJson(res, 200, payload);
                  return;
                } catch (e: any) {
                  console.warn("Failed to parse allocation_result.json, checking stdout:", e.message);
                }
              }

              // Fallback: Try parsing stdout as JSON
              try {
                const trimmed = stdout.trim();
                const jsonStart = trimmed.indexOf("{");
                const jsonEnd = trimmed.lastIndexOf("}");
                if (jsonStart !== -1 && jsonEnd !== -1) {
                  const jsonStr = trimmed.slice(jsonStart, jsonEnd + 1);
                  const payload = JSON.parse(jsonStr);
                  payload.jobId = jobId;
                  sendJson(res, 200, payload);
                  return;
                }
              } catch (e: any) {
                console.warn("Failed to parse stdout JSON:", e.message);
              }

              sendJson(res, 500, { error: "Result JSON file was not generated.", stdout, stderr });
            });
          } catch (err: any) {
            console.error("Allocation execution error:", err);
            sendJson(res, 500, { error: err.message || "Internal server error." });
          }
          return;
        }

        // Endpoint: GET /api/allocation/download?jobId=...&file=...
        if (pathname === "/api/allocation/download" && (req.method === "GET" || req.method === "HEAD")) {
          const jobId = url.searchParams.get("jobId");
          const fileKey = url.searchParams.get("file");

          if (!jobId || !fileKey) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Missing jobId or file parameter.");
            return;
          }

          // Security check to prevent directory traversal
          if (jobId.includes("..") || fileKey.includes("..")) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Invalid path parameter.");
            return;
          }

          const jobOutputDir = path.join(JOBS_DIR, jobId, "output");
          if (!fs.existsSync(jobOutputDir)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Job output not found.");
            return;
          }

          // If downloading a zip bundle of all files
          if (fileKey === "all_zip") {
            const zipPath = path.join(jobOutputDir, "all_allocation_outputs.zip");
            if (!fs.existsSync(zipPath)) {
              // Create zip via python
              const pyZip = spawn("python3", [
                "-c",
                `import shutil; shutil.make_archive('${zipPath.replace(/\.zip$/, "")}', 'zip', '${jobOutputDir}')`,
              ]);
              pyZip.on("close", (code) => {
                if (code === 0 && fs.existsSync(zipPath)) {
                  sendFile(
                    res,
                    zipPath,
                    `allocation_complete_${jobId}.zip`,
                    "application/zip"
                  );
                } else {
                  res.writeHead(500, { "Content-Type": "text/plain" });
                  res.end("Failed to generate zip archive.");
                }
              });
              return;
            }
            sendFile(res, zipPath, `allocation_complete_${jobId}.zip`, "application/zip");
            return;
          }

          // If downloading per-slot rosters zip
          if (fileKey === "per_slot_rosters_zip") {
            const rosterDir = path.join(jobOutputDir, "per_slot_rosters");
            const zipPath = path.join(jobOutputDir, "per_slot_rosters.zip");
            if (fs.existsSync(rosterDir)) {
              const pyZip = spawn("python3", [
                "-c",
                `import shutil; shutil.make_archive('${zipPath.replace(/\.zip$/, "")}', 'zip', '${rosterDir}')`,
              ]);
              pyZip.on("close", (code) => {
                if (code === 0 && fs.existsSync(zipPath)) {
                  sendFile(
                    res,
                    zipPath,
                    `per_slot_rosters_${jobId}.zip`,
                    "application/zip"
                  );
                } else {
                  res.writeHead(500, { "Content-Type": "text/plain" });
                  res.end("Failed to generate rosters zip.");
                }
              });
              return;
            }
          }

          const fileMap: Record<string, { filename: string; mime: string }> = {
            app_data: { filename: "app_data.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            dashboard_output: { filename: "dashboard_output.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            master_allocation: { filename: "master_allocation.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            dashboard_style_summary: { filename: "dashboard_style_summary.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            area_grade_group_summary: { filename: "area_grade_group_summary.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            unassigned_students: { filename: "unassigned_students.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            shortfall_explanation_xlsx: { filename: "shortfall_math_explanation.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            shortfall_explanation_txt: { filename: "shortfall_math_explanation.txt", mime: "text/plain; charset=utf-8" },
          };

          const target = fileMap[fileKey] || { filename: `${fileKey}.xlsx`, mime: "application/octet-stream" };
          const filePath = path.join(jobOutputDir, target.filename);
          sendFile(res, filePath, target.filename, target.mime);
          return;
        }

        // Endpoint: GET /api/allocation/sample-template?type=students|labs|dashboard
        if (pathname === "/api/allocation/sample-template" && req.method === "GET") {
          const type = url.searchParams.get("type") || "students";
          const sampleDir = path.resolve(process.cwd(), "scratch/sample_templates");
          fs.mkdirSync(sampleDir, { recursive: true });

          if (type === "students") {
            const csv = [
              "S_ID,Grade,Physical Area",
              "STU-001,Grade 4,Nasr City",
              "STU-002,Grade 4,Nasr City",
              "STU-003,Grade 5,Nasr City",
              "STU-004,Grade 5,Nasr City",
              "STU-005,Grade 6,Nasr City",
              "STU-006,Grade 4,Dokki",
              "STU-007,Grade 4,Dokki",
              "STU-008,Grade 5,Dokki",
              "STU-009,Grade 6,Dokki",
              "STU-010,Grade 6,Dokki",
            ].join("\n");
            res.writeHead(200, {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": 'attachment; filename="sample_students_template.csv"',
              "Access-Control-Allow-Origin": "*",
            });
            res.end(csv);
            return;
          }

          if (type === "labs") {
            const csv = [
              "Lab ID,Area,Lab Capacity",
              "LAB-NC-01,Nasr City,25",
              "LAB-NC-02,Nasr City,20",
              "LAB-DOK-01,Dokki,25",
              "LAB-DOK-02,Dokki,15",
            ].join("\n");
            res.writeHead(200, {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": 'attachment; filename="sample_labs_template.csv"',
              "Access-Control-Allow-Origin": "*",
            });
            res.end(csv);
            return;
          }

          if (type === "dashboard") {
            const csv = [
              "Gov,Vendor Name,Center Name,Lab ID,Area,Lab Capacity,Number of Sessions",
              "Cairo,Vendor Alpha,Nasr City Center,LAB-NC-01,Nasr City,25,",
              "Cairo,Vendor Beta,Heliopolis Hub,LAB-NC-02,Nasr City,20,",
              "Giza,Vendor Gamma,Dokki IT Hub,LAB-DOK-01,Dokki,25,",
            ].join("\n");
            res.writeHead(200, {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": 'attachment; filename="sample_dashboard_template.csv"',
              "Access-Control-Allow-Origin": "*",
            });
            res.end(csv);
            return;
          }
        }

        next();
      });
    },
  };
}
