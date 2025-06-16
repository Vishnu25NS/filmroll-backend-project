// backend/app.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec, execSync } = require("child_process"); // Import exec
const util = require("util"); // Import util
const execPromise = util.promisify(exec); // Promisify exec
const { compressVideo, compressImage, compressAudio } = require("./compress");
const os = require("os");
const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";


const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.static("public"));

// Multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = Date.now();
    cb(null, base + ext);
  },
});

const upload = multer({ storage: multer.memoryStorage() });

function hasAudioTrack(filePath) {
  try {
    const cmd = `"${ffprobePath}" -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${filePath.replace(/\\/g, "/")}"`;
   const output = execSync(ffprobeCmd).toString().trim(); // (you're using wrong variable name)
    console.log("Checking audio track with command:", cmd);
    console.log("FFprobe output:", output);
    return output.includes("audio");
  } catch (e) {
    return false;
  }
}

// Upload route (video/audio/image) - Consolidated and corrected
app.post("/upload", upload.array("media", 3), async (req, res) => {
  try {
    const imageExts = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".avif"];
    const videoExts = [".mp4", ".mov", ".avi", ".wmv", ".flv", ".webm", ".mkv"];
    const audioExts = [".mp3", ".wav", ".aac", ".ogg", ".flac", ".m4a"];

    const imageFiles = req.files.filter(file => imageExts.includes(path.extname(file.originalname).toLowerCase()));
    const otherFiles = req.files.filter(file => !imageExts.includes(path.extname(file.originalname).toLowerCase()));

    // Enforce max 3 images per upload
    if (imageFiles.length > 3) {
      return res.status(400).json({ message: "You can only upload up to 3 images at a time." });
    }

    const results = [];

    // --- Process images ---
    for (const file of imageFiles) {
      const ext = path.extname(file.originalname).toLowerCase();
      const originalName = path.basename(file.originalname, ext);
      const randomNum = Math.floor(Math.random() * 90 + 10); // 2-digit number
      const baseName = `${originalName}_${randomNum}`;
      const compressedDir = path.join(__dirname, "public", "compressed");

      // Use OS temp dir for temp file
      const tempPath = path.join(os.tmpdir(), `${baseName}${ext}`);

      // Save buffer to temp file for processing
      fs.writeFileSync(tempPath, file.buffer);

      // For images: compress and save mapping
      const outputExt = ext === ".avif" ? ".jpg" : ext;
      const outputPath = path.join(compressedDir, `compressed-${baseName}${outputExt}`);
      const outputFile = `compressed-${baseName}${outputExt}`;

      try {
        const originalSize = fs.statSync(tempPath).size; // Get before deleting temp file
        await compressImage(tempPath, outputPath, outputExt);

        // Save metadata (original name and size) for images
        fs.writeFileSync(
          outputPath + ".json",
          JSON.stringify({ originalName: file.originalname, originalSize })
        );

        results.push({
          type: "image",
          fileUrl: `/compressed/${outputFile}`,
          originalName: file.originalname,
          originalSize,
          compressedSize: fs.statSync(outputPath).size,
        });

        // Now you can safely delete the temp file
        try {
          fs.unlinkSync(tempPath);
        } catch (err) {
          console.error("Failed to delete temp file:", tempPath, err);
        }
      } catch (err) {
        results.push({
          type: "image",
          fileUrl: null,
          originalName: file.originalname,
          originalSize: file.size,
          compressedSize: 0,
          error: `Compression failed for ${file.originalname}: ${err.message}`,
        });
      }
    }

    // --- Process videos and audios ---
    for (const file of otherFiles) {
      const ext = path.extname(file.originalname).toLowerCase();
      const originalName = path.basename(file.originalname, ext);
      const randomNum = Math.floor(Math.random() * 90 + 10); // 2-digit number
      const baseName = `${originalName}_${randomNum}`;
      const compressedDir = path.join(__dirname, "public", "compressed");

      // Use OS temp dir for temp file
      const tempPath = path.join(os.tmpdir(), `${baseName}${ext}`);

      // Save buffer to temp file for processing
      fs.writeFileSync(tempPath, file.buffer);

      if (videoExts.includes(ext)) {
        // Check duration
        let durationSec = 0;
        try {
        const ffprobeCmd = `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempPath.replace(/\\/g, "/")}"`;
const output = execSync(ffprobeCmd).toString().trim(); // ✅ correct variable name
          durationSec = parseFloat(output);
        } catch (e) {
          durationSec = 0;
        }

        if (durationSec > 120) {
          fs.unlinkSync(tempPath);
          results.push({
            type: "video",
            fileUrl: null,
            originalName: file.originalname,
            originalSize: file.size,
            compressedSize: 0,
            error: "Video duration exceeds 2 minutes. Only videos less than 2 minutes are allowed."
          });
          continue;
        }

        // Proceed with compression
        const outputPath = path.join(compressedDir, `compressed-${baseName}.mp4`);
        await compressVideo(tempPath, outputPath);

        // Save metadata (original name and size)
        fs.writeFileSync(
          outputPath + ".json",
          JSON.stringify({ originalName: file.originalname, originalSize: file.size })
        );

        fs.unlinkSync(tempPath); // Remove temp file

        results.push({
          type: "video",
          fileUrl: `/compressed/compressed-${baseName}.mp4`,
          originalName: file.originalname,
          originalSize: file.size,
          compressedSize: fs.statSync(outputPath).size,
        });
      } else if (audioExts.includes(ext)) {
        // For audio, compress using the appropriate method
        const outputPath = path.join(compressedDir, `compressed-${baseName}.aac`);

        // Check duration of audio
        const ffprobeCmd = `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempPath.replace(/\\/g, "/")}"`;
        try {
          const { stdout } = await execPromise(ffprobeCmd); // Use execPromise here
          const duration = parseFloat(stdout.trim());

          if (isNaN(duration)) {
            fs.unlinkSync(tempPath);
            // Changed this to push to results array for consistency
            results.push({
              type: "audio",
              fileUrl: null,
              originalName: file.originalname,
              originalSize: file.size,
              compressedSize: 0,
              error: "Could not determine audio duration. Please upload a valid audio file under 2 minutes."
            });
            continue; // Continue to the next file
          }

          if (duration > 120) {
            fs.unlinkSync(tempPath);
            // Changed this to push to results array for consistency
            results.push({
              type: "audio",
              fileUrl: null,
              originalName: file.originalname,
              originalSize: file.size,
              compressedSize: 0,
              error: "Only audio files less than 2 minutes are allowed."
            });
            continue; // Continue to the next file
          }
        } catch (err) {
          fs.unlinkSync(tempPath);
          // Changed this to push to results array for consistency
          results.push({
            type: "audio",
            fileUrl: null,
            originalName: file.originalname,
            originalSize: file.size,
            compressedSize: 0,
            error: `Audio duration check failed for ${file.originalname}: ${err.message}`
          });
          continue; // Continue to the next file
        }

        await compressAudio(tempPath, outputPath);

        // Save metadata (original name and size)
        fs.writeFileSync(
          outputPath + ".json",
          JSON.stringify({ originalName: file.originalname, originalSize: file.size })
        );

        fs.unlinkSync(tempPath); // Remove temp file

        results.push({
          type: "audio",
          fileUrl: `/compressed/${path.basename(outputPath)}`,
          originalName: file.originalname,
          originalSize: file.size,
          compressedSize: fs.statSync(outputPath).size,
        });
      } else {
        // If the file is neither an image, video, nor allowed audio type,
        // it might be an unsupported format.
        fs.unlinkSync(tempPath);
        results.push({
          type: "unknown",
          fileUrl: null,
          originalName: file.originalname,
          originalSize: file.size,
          compressedSize: 0,
          error: "Unsupported file format."
        });
      }
    }

    // Update mapping file - assuming 'mapping' is properly defined.
    // Ensure mapping is defined globally or within scope.
    if (typeof mapping !== 'undefined') {
      fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
      console.log("Mapping updated");
    }

    console.log("Sending response:", results);
    return res.status(200).json({ message: "Uploaded and Compressed", results });
  } catch (err) {
    console.error("Overall compression route error:", err);
    res.status(500).json({ error: "Compression failed", details: err.message });
  }
});

// List all compressed media
app.get("/compressed", (req, res) => {
  const compressedDir = path.join(__dirname, "public", "compressed");

  fs.readdir(compressedDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Cannot read compressed directory" });

    const media = files
      .filter(file => !file.endsWith(".json"))
      .map((file) => {
        const compressedPath = path.join(compressedDir, file);
        const metaPath = compressedPath + ".json";
        let originalName = "";
        let originalSize = 0;

        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath));
          originalName = meta.originalName;
          originalSize = meta.originalSize;
        }

        return {
          url: `/compressed/${file}`,
          originalName,
          compressedSize: fs.existsSync(compressedPath) ? fs.statSync(compressedPath).size : 0,
          originalSize,
        };
      });

    res.json(media);
  });
});

const imageExts = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".avif"];
const mappingPath = path.join(__dirname, "public", "compressed", "mapping.json");
let mapping = {}; // Ensure 'mapping' is declared once in the global/module scope
if (fs.existsSync(mappingPath)) {
  mapping = JSON.parse(fs.readFileSync(mappingPath, "utf-8"));
}

app.listen(PORT, () => {
  console.log(`🚀 FilmRoll backend (GStreamer) running on http://localhost:${PORT}`);
});