import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { probeMediaFile } from './probe.js';
import { createConvertedStream } from './streams.js';
import { ensureFreeDiskSpace } from './security.js';

function ffmpegArguments(job, outputPath) {
  const selectedAudio = job.conversionOptions.audioTrack;
  const audio = job.audioTracks.find((track) => track.index === selectedAudio) || job.audioTracks[0] || null;
  const needsScale = job.conversionOptions.resolution !== 'original';
  const copyVideo = job.video.codec === 'h264'
    && job.video.pixelFormat === 'yuv420p'
    && !needsScale;
  const copyAudio = !audio || ['aac', 'mp3'].includes(audio.codec);
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-progress', 'pipe:1', '-nostats', '-y',
    '-i', job.sourcePath,
    '-map', `0:${job.video.index}`,
  ];
  if (audio) args.push('-map', `0:${audio.index}`);
  args.push('-sn', '-dn', '-map_metadata', '-1');

  if (copyVideo) {
    args.push('-c:v', 'copy');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
    if (needsScale) args.push('-vf', `scale=-2:${job.conversionOptions.resolution}`);
  }

  if (audio) {
  if (copyAudio) {
    args.push('-c:a', 'copy');
  } else {
    // 192k bitrate + proper ITU-R BS.775 stereo downmix filter
    args.push(
      '-c:a', 'aac',
      '-b:a', '192k',
      '-af', 'pan=stereo|FL < 1.0*FL + 0.707*FC + 0.707*BL|FR < 1.0*FR + 0.707*FC + 0.707*BR'
    );
  }
}
  if (!copyVideo) args.push('-threads:v', '4');
  args.push('-movflags', '+faststart', '-f', 'mp4', outputPath);
  return { args, copyVideo, copyAudio };
}

export async function convertPreparedJob(job, runProcess) {
  const outputPath = path.join(config.downloadDir, `${job.id}.converted.mp4`);
  const finalPath = path.join(config.downloadDir, `${crypto.randomBytes(16).toString('hex')}.mp4`);
  const { args, copyVideo, copyAudio } = ffmpegArguments(job, outputPath);
  const sourceSize = fs.statSync(job.sourcePath).size;
  ensureFreeDiskSpace(sourceSize, config.downloadDir);
  job.status = 'converting';
  job.message = copyVideo && copyAudio ? 'Remuxing browser-compatible video' : 'Converting video';
  job.progress = 45;
  await runProcess(job, 'ffmpeg', args, {
    timeoutMs: 6 * 60 * 60_000,
    onLine: (line) => {
      const timeText = /^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
      if (timeText && job.duration > 0) {
        const seconds = Number(timeText[1]) * 3600 + Number(timeText[2]) * 60 + Number(timeText[3]);
        const percent = Math.min(100, Math.floor((seconds / job.duration) * 100));
        job.progress = 45 + Math.floor(percent * 0.5);
        job.message = `Converting — ${percent}%`;
      }
    },
  });
  if (job.status === 'cancelled') throw Object.assign(new Error('Conversion cancelled.'), { cancelled: true });
  const validation = await probeMediaFile(outputPath, {
    onSpawn: (child) => { job.cancelCurrent = () => child.kill('SIGKILL'); },
  });
  job.cancelCurrent = null;
  if (job.status === 'cancelled') throw Object.assign(new Error('Conversion cancelled.'), { cancelled: true });
  if (!validation.video || validation.video.codec !== 'h264' || validation.video.pixelFormat !== 'yuv420p'
      || !validation.formatNames.some((format) => format === 'mp4' || format === 'mov')) {
    throw new Error('The converted output is not a browser-compatible H.264 MP4.');
  }
  const fileSize = fs.statSync(outputPath).size;
  if (!fileSize) throw new Error('The converted output was empty.');
  fs.renameSync(outputPath, finalPath);
  job.outputFilePath = finalPath;
  const stream = createConvertedStream(
    job.ownerUserId,
    finalPath,
    `${path.parse(job.sourceName).name || 'video'}.mp4`,
    fileSize,
  );
  fs.rmSync(job.sourcePath, { force: true });
  job.sourcePath = null;
  job.outputStreamId = stream.streamId;
  job.status = 'done';
  job.progress = 100;
  job.message = 'Conversion complete';
  job.completedAt = Date.now();
}
