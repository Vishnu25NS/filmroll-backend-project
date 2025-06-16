const { exec, execSync } = require("child_process");
const path = require("path");
const util = require("util");
const sharp = require("sharp");
const fs = require("fs"); // <-- Add this line

const execPromise = util.promisify(exec);

const ffmpegPath = process.env.FFMPEG_PATH || (process.platform === "win32" ? "bin/ffmpeg.exe" : "ffmpeg");
const ffprobePath = process.env.FFPROBE_PATH || (process.platform === "win32" ? "bin/ffprobe.exe" : "ffprobe");

// If you use fluent-ffmpeg:
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

async function compressVideo(inputPath, outputPath) {
  const normalizedInput = path.resolve(inputPath);
  const normalizedOutput = path.resolve(outputPath);
  const escapedInput = normalizedInput.replace(/\\/g, "/");
  const escapedOutput = normalizedOutput.replace(/\\/g, "/");

  // Detect if video has audio
  const audioPresent = hasAudioTrack(inputPath);

  // Step 1: Extract metadata using ffprobe (including bit_rate)
  const ffprobeCmd = `"${ffprobePath}" -v error -show_entries format=bit_rate -of default=noprint_wrappers=1:nokey=1 "${escapedInput}"`;

  let width = 640,
    height = 360,
    duration = 60,
    inputBitrate = 3000000; // Default 3 Mbps in bits

  try {
    const { stdout } = await execPromise(ffprobeCmd);
    inputBitrate = parseInt(stdout.trim());
    console.log(`Total file bitrate: ${inputBitrate} bits per second (${(inputBitrate / 1000).toFixed(2)} kbps)`);
  } catch (err) {
    console.warn("⚠️ Couldn't read total file bitrate, using default.");
  }

  // Step 2: Dynamic compression settings
  const HD_BITRATE = 5000000; // 5 Mbps in bits per second
  let videoBitrate;

  if (!isNaN(inputBitrate) && inputBitrate < HD_BITRATE) {
    videoBitrate = Math.floor(inputBitrate / 1000)+100;// convert to kbps for GStreamer
  } else {
    videoBitrate = HD_BITRATE / 1000; // 5000 kbps
  }

  let audioBitrate = 128000; // Default 128 kbps

  if (width <= 720) {
    audioBitrate = 96000;
  }

  // Step 3: GStreamer compression command
  const ext = path.extname(inputPath).toLowerCase();
  console.log("Detected file extension:", ext);
  let gstCmd;
  const shouldDownscale = inputBitrate < 1000000;
  const scalePart = shouldDownscale
    ? 'videoscale ! video/x-raw,width=854,height=480 ! ' // 480p (16:9), adjust as needed for your aspect ratio
    : '';

  // For lossless, ignore bitrate and use quantizer=0
  const losslessVideoPart = 'x264enc quantizer=0 speed-preset=ultrafast tune=zerolatency ! queue ! mux. ';
  const lossyAudioPart = 'audioconvert ! voaacenc bitrate=128000 ! queue ! mux. ';

  if (audioPresent) {
    // Video + audio pipeline (your current one)
    gstCmd = `gst-launch-1.0 -e filesrc location="${escapedInput}" ! decodebin name=dec ` +
      `dec. ! queue ! videoconvert ! ${shouldDownscale ? scalePart : ''}x264enc bitrate=${videoBitrate} speed-preset=ultrafast ! queue ! mux. ` +
      `dec. ! queue ! audioconvert ! voaacenc bitrate=${audioBitrate} ! queue ! mux. ` +
      `mp4mux name=mux faststart=true ! filesink location="${escapedOutput}"`;
  } else {
    // Video-only pipeline (no audio branch)
    gstCmd = `gst-launch-1.0 -e filesrc location="${escapedInput}" ! decodebin ! ` +
      `${shouldDownscale ? scalePart : ''}videoconvert ! x264enc bitrate=${videoBitrate} speed-preset=ultrafast ! mp4mux faststart=true ! filesink location="${escapedOutput}"`;
  }

  console.log("🚀 Running GStreamer Command:\n", gstCmd);

  // Step 4: Run it
  return new Promise((resolve, reject) => {
    exec(gstCmd, (error, stdout, stderr) => {
      if (error) {
        console.error("❌ GStreamer Compression Error:", stderr);
        return reject(new Error("Compression failed with GStreamer."));
      }
      console.log("✅ Compression Done:\n", stdout);
      resolve("Compression successful");
    });
  });
}

async function compressImage(inputPath, outputPath, ext) {
  let pipeline = sharp(inputPath).resize({ width: 1280 });

  if (ext === ".jpg" || ext === ".jpeg") {
    pipeline = pipeline.jpeg({ quality: 60 });
  } else if (ext === ".png") {
    pipeline = pipeline.png({ compressionLevel: 8 });
  } else if (ext === ".webp") {
    pipeline = pipeline.webp({ quality: 60 });
  } else {
    pipeline = pipeline.jpeg({ quality: 60 });
  }

  await pipeline.toFile(outputPath);
}

async function compressAudio(inputPath, outputPath) {
  const normalizedInput = path.resolve(inputPath);
  const normalizedOutput = path.resolve(outputPath);
  const escapedInput = normalizedInput.replace(/\\/g, "/");
  const escapedOutput = normalizedOutput.replace(/\\/g, "/");

  const gstCmd = `gst-launch-1.0 -e filesrc location="${escapedInput}" ! decodebin name=dec ` +
    `dec. ! queue ! audioconvert ! voaacenc bitrate=96000 ! queue ! mp4mux ! filesink location="${escapedOutput}"`;

  console.log("🚀 Running GStreamer Audio Command:\n", gstCmd);
  return new Promise((resolve, reject) => {
    exec(gstCmd, (error, stdout, stderr) => {
      if (error) {
        console.error("❌ GStreamer Audio Compression Error:", stderr);
        return reject(new Error("Audio compression failed with GStreamer."));
      }
      console.log("✅ Audio Compression Done:\n", stdout);
      resolve("Audio compression successful");
    });
  });
}

const hasAudioTrack = (inputPath) => {
  try {
    const cmd = `"${ffprobePath}" -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${inputPath.replace(/\\/g, "/")}"`;
    const output = execSync(cmd).toString().trim();
    return output.includes("audio");
  } catch (e) {
    return false;
  }
};

module.exports = { compressVideo, compressImage, compressAudio, hasAudioTrack };