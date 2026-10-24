/**
 * videoToComic.ts
 *
 * Client-side "Video to Comic" keyframe extraction and 6-panel comic layout mapping.
 * Implemented entirely using native HTML5 APIs (<video> and <canvas>) without FFmpeg WASM.
 *
 * Pipeline:
 * 1. Lightweight Scene Change Detection (RGB pixel difference on 64x64 thumbnail canvas)
 * 2. Sharpness Scoring (Laplacian Variance on grayscale frame)
 * 3. Local Peak Search (Micro-search around scene candidate for peak Laplacian sharpness)
 * 4. Pagination & 6-Panel Grid Mapping (Full-resolution capture mapped into 6-panel comic pages)
 */

import { TreeNode, PanelNode, createGridTree } from '@/components/ComicCanvas';

export interface VideoToComicOptions {
  /** Time step in seconds for initial scene change scanning (default: 0.5) */
  stepSeconds?: number;
  /** Average RGB pixel difference threshold (0-255) for scene transition detection (default: 24) */
  sceneThreshold?: number;
  /** Minimum time in seconds between two detected scenes (default: 0.8) */
  minSceneInterval?: number;
  /** Micro-search offsets in seconds for local peak sharpness search (default: [-0.15, -0.075, 0, 0.075, 0.15]) */
  microSearchOffsets?: number[];
  /** Maximum number of keyframes to extract (default: 48) */
  maxKeyframes?: number;
  /** Thumbnail dimension for scene scanning (default: 64) */
  thumbSize?: number;
  /** Sharpness analysis dimension for local peak evaluation (default: 128) */
  sharpnessSampleSize?: number;
  /** Target image format for extracted keyframes (default: 'image/jpeg') */
  imageFormat?: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Image quality (0 to 1, default: 0.90) */
  imageQuality?: number;
  /** Progress callback */
  onProgress?: (progress: VideoProcessingProgress) => void;
  /** Cancellation check callback */
  isCancelled?: () => boolean;
}

export interface VideoProcessingProgress {
  phase: 'init' | 'scanning' | 'refining' | 'extracting' | 'complete' | 'error';
  percent: number; // 0 - 100
  statusText: string;
  currentTime?: number;
  totalDuration?: number;
  candidatesFound?: number;
  currentStep?: number;
  totalSteps?: number;
}

export interface ExtractedKeyframe {
  timestamp: number;
  dataUrl: string;
  blob: Blob;
  sharpnessScore: number;
  index: number;
}

export interface ComicPageData {
  id: string;
  tree: TreeNode;
  bubbles: any[];
  title?: string;
}

/**
 * Computes average absolute RGB pixel difference between two ImageData buffers.
 * Returns value in range 0 - 255.
 */
export function computeFrameDifference(dataA: Uint8ClampedArray, dataB: Uint8ClampedArray): number {
  if (dataA.length !== dataB.length || dataA.length === 0) return 0;
  
  let totalDiff = 0;
  const numPixels = dataA.length / 4;

  for (let i = 0; i < dataA.length; i += 4) {
    const diffR = Math.abs(dataA[i] - dataB[i]);
    const diffG = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const diffB = Math.abs(dataA[i + 2] - dataB[i + 2]);
    totalDiff += (diffR + diffG + diffB) / 3;
  }

  return totalDiff / numPixels;
}

/**
 * Computes Laplacian Variance of an ImageData buffer to estimate sharpness.
 * Higher variance indicates sharp, in-focus edges; lower variance indicates motion blur or defocus.
 *
 * Kernel:
 * [ 0,  1,  0]
 * [ 1, -4,  1]
 * [ 0,  1,  0]
 */
export function computeLaplacianVariance(imageData: ImageData): number {
  const { width, height, data } = imageData;
  if (width < 3 || height < 3) return 0;

  // Convert to grayscale luminance
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Standard perceptual luminance weights
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  // Apply discrete 3x3 Laplacian operator
  let sum = 0;
  let count = 0;
  const laplacianValues = new Float32Array((width - 2) * (height - 2));

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    const prevRowOffset = (y - 1) * width;
    const nextRowOffset = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const center = gray[rowOffset + x];
      const left = gray[rowOffset + (x - 1)];
      const right = gray[rowOffset + (x + 1)];
      const up = gray[prevRowOffset + x];
      const down = gray[nextRowOffset + x];

      const lap = left + right + up + down - 4 * center;
      laplacianValues[count++] = lap;
      sum += lap;
    }
  }

  if (count === 0) return 0;

  // Calculate variance: Var(X) = E[(X - mu)^2]
  const mean = sum / count;
  let varianceSum = 0;
  for (let i = 0; i < count; i++) {
    const diff = laplacianValues[i] - mean;
    varianceSum += diff * diff;
  }

  return varianceSum / count;
}

/**
 * Non-blocking utility to yield execution back to the browser event loop,
 * preventing UI freeze and "Page Unresponsive" warnings.
 */
export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Safely seeks an HTML5 video element to a specific timestamp.
 */
export function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const clampedTime = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.05)));

    if (Math.abs(video.currentTime - clampedTime) < 0.02) {
      resolve();
      return;
    }

    let resolved = false;

    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      clearTimeout(timeoutTimer);
    };

    const onSeeked = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve();
      }
    };

    const onError = (e: Event) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Video seek error: ' + (video.error?.message || 'unknown')));
      }
    };

    const timeoutTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        // Resolve anyway on timeout to avoid hanging the entire pipeline
        resolve();
      }
    }, 2000);

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });

    try {
      video.currentTime = clampedTime;
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/**
 * Populates a Comic TreeNode with image URLs in a balanced left-to-right, top-to-bottom order.
 */
export function populateTreeWithImages(tree: TreeNode, images: string[]): TreeNode {
  let imgIdx = 0;

  function walk(node: TreeNode): TreeNode {
    if (node.type === 'panel') {
      const nextImg = images[imgIdx++];
      return {
        ...node,
        imageUrl: nextImg || node.imageUrl,
      };
    }

    return {
      ...node,
      c1: walk(node.c1),
      c2: walk(node.c2),
    };
  }

  return walk(tree);
}

/**
 * Groups an array of extracted keyframe image data URLs into 6-panel ComicPage objects.
 * Default comic grid: 3 rows x 2 cols = 6 panels per page.
 */
export function paginateKeyframesTo6PanelPages(
  keyframes: (ExtractedKeyframe | string)[],
  options?: { baseTitle?: string; panelsPerPage?: number }
): ComicPageData[] {
  const images = keyframes.map((k) => (typeof k === 'string' ? k : k.dataUrl));
  const panelsPerPage = options?.panelsPerPage || 6;
  const baseTitle = options?.baseTitle || 'Comic Page';
  const pages: ComicPageData[] = [];

  const totalPages = Math.ceil(images.length / panelsPerPage) || 1;

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const startIdx = pageIdx * panelsPerPage;
    const pageImages = images.slice(startIdx, startIdx + panelsPerPage);

    // Default 6-panel comic grid (3 rows x 2 cols)
    const emptyGrid = createGridTree(3, 2);
    const populatedTree = populateTreeWithImages(emptyGrid, pageImages);

    pages.push({
      id: `comic-page-${Date.now()}-${pageIdx}`,
      title: `${baseTitle} ${pageIdx + 1}`,
      tree: populatedTree,
      bubbles: [],
    });
  }

  return pages;
}

/**
 * Server-side FFmpeg extraction fallback for video formats and codecs not natively
 * supported by browser HTML5 <video> (e.g. AVI, DivX, Xvid, WMV, FLV, uncompressed).
 */
export async function extractViaServerFallback(
  videoSource: File | Blob | string,
  options: VideoToComicOptions = {}
): Promise<ExtractedKeyframe[]> {
  const { maxKeyframes = 36, onProgress } = options;

  onProgress?.({
    phase: 'scanning',
    percent: 25,
    statusText: 'Processing video container and codecs...',
  });

  let blob: Blob;
  let filename = 'video.avi';

  if (typeof videoSource === 'string') {
    const res = await fetch(videoSource);
    blob = await res.blob();
  } else {
    blob = videoSource;
    if ((videoSource as File).name) {
      filename = (videoSource as File).name;
    }
  }

  onProgress?.({
    phase: 'refining',
    percent: 60,
    statusText: 'Extracting keyframes from video...',
  });

  const response = await fetch(
    `/api/extract-video-keyframes?filename=${encodeURIComponent(filename)}&maxKeyframes=${maxKeyframes}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: blob,
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Video extraction server error: ${errText}`);
  }

  const result = await response.json();
  if (!result.success || !Array.isArray(result.keyframes) || result.keyframes.length === 0) {
    throw new Error(result.error || 'No keyframes could be extracted from this video.');
  }

  onProgress?.({
    phase: 'complete',
    percent: 100,
    statusText: `Extracted ${result.keyframes.length} keyframes!`,
  });

  const finalKeyframes: ExtractedKeyframe[] = [];
  for (let i = 0; i < result.keyframes.length; i++) {
    const kf = result.keyframes[i];
    const base64Data = kf.dataUrl.split(',')[1] || '';
    const byteChars = atob(base64Data);
    const byteNumbers = new Uint8Array(byteChars.length);
    for (let j = 0; j < byteChars.length; j++) {
      byteNumbers[j] = byteChars.charCodeAt(j);
    }
    const frameBlob = new Blob([byteNumbers], { type: 'image/jpeg' });

    finalKeyframes.push({
      timestamp: kf.timestamp || i * 1.5,
      dataUrl: kf.dataUrl,
      blob: frameBlob,
      sharpnessScore: 100,
      index: i,
    });
  }

  return finalKeyframes;
}

/**
 * Main Video to Comic pipeline function:
 * 1. Scene detection via RGB pixel difference on 64x64 canvas
 * 2. Sharpness scoring via 3x3 Laplacian variance
 * 3. Local peak micro-search around scene candidate timestamps
 * 4. High-resolution canvas rendering and export
 * 5. Automatic server fallback if browser HTML5 <video> cannot decode container or codec
 */
export async function extractVideoKeyframes(
  videoSource: File | Blob | string,
  options: VideoToComicOptions = {}
): Promise<ExtractedKeyframe[]> {
  const {
    stepSeconds = 0.5,
    sceneThreshold = 24,
    minSceneInterval = 0.8,
    microSearchOffsets = [-0.15, -0.075, 0, 0.075, 0.15],
    maxKeyframes = 48,
    thumbSize = 64,
    sharpnessSampleSize = 128,
    imageFormat = 'image/jpeg',
    imageQuality = 0.90,
    onProgress,
    isCancelled = () => false,
  } = options;

  // If the file extension is .avi, .wmv, .flv, .ts, .mts, or .vob, HTML5 <video> typically
  // cannot demux it client-side in Chromium/Safari. Immediately route to high-speed server extractor.
  if (typeof videoSource !== 'string' && videoSource instanceof File) {
    const ext = videoSource.name.split('.').pop()?.toLowerCase();
    if (ext && ['avi', 'wmv', 'flv', 'vob', 'asf'].includes(ext)) {
      return await extractViaServerFallback(videoSource, options);
    }
  }

  let videoUrl = '';
  let videoEl: HTMLVideoElement | null = null;
  let thumbCanvas: HTMLCanvasElement | null = null;
  let sharpnessCanvas: HTMLCanvasElement | null = null;
  let fullCanvas: HTMLCanvasElement | null = null;

  try {
    // -------------------------------------------------------------------------
    // Phase 0: Initialize HTML5 <video> and canvases
    // -------------------------------------------------------------------------
    onProgress?.({
      phase: 'init',
      percent: 0,
      statusText: 'Initializing video decoder...',
    });

    videoEl = document.createElement('video');
    videoEl.preload = 'auto';
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.style.position = 'fixed';
    videoEl.style.top = '-9999px';
    videoEl.style.left = '-9999px';
    videoEl.style.opacity = '0';
    videoEl.style.pointerEvents = 'none';
    document.body.appendChild(videoEl);

    const VIDEO_MIME_MAP: Record<string, string> = {
      mp4: 'video/mp4',
      m4v: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      mkv: 'video/x-matroska',
      avi: 'video/x-msvideo',
      wmv: 'video/x-ms-wmv',
      flv: 'video/x-flv',
      ogv: 'video/ogg',
      ogg: 'video/ogg',
      '3gp': 'video/3gpp',
      ts: 'video/mp2t',
      mts: 'video/mp2t',
      m2ts: 'video/mp2t',
      vob: 'video/dvd',
      asf: 'video/x-ms-asf',
    };

    let processedSource: Blob | string = videoSource;
    if (typeof videoSource !== 'string' && videoSource instanceof Blob) {
      const fileName = (videoSource as File).name || '';
      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      const mappedMime = VIDEO_MIME_MAP[ext];
      if (mappedMime && (!videoSource.type || videoSource.type === 'application/octet-stream')) {
        processedSource = new Blob([videoSource], { type: mappedMime });
      }
    }

    if (typeof processedSource === 'string') {
      videoUrl = processedSource;
    } else {
      videoUrl = URL.createObjectURL(processedSource);
    }
    videoEl.src = videoUrl;

    // Await metadata loading with automatic fallback if browser cannot decode
    let nativeDecodeFailed = false;
    await new Promise<void>((resolve) => {
      if (!videoEl) {
        nativeDecodeFailed = true;
        resolve();
        return;
      }

      const onLoadedMetadata = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        nativeDecodeFailed = true;
        resolve();
      };
      const cleanup = () => {
        videoEl?.removeEventListener('loadedmetadata', onLoadedMetadata);
        videoEl?.removeEventListener('error', onError);
      };

      videoEl.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
      videoEl.addEventListener('error', onError, { once: true });

      // Fast check if already loaded
      if (videoEl.readyState >= 1) {
        cleanup();
        resolve();
      }
    });

    if (nativeDecodeFailed || !videoEl.duration || isNaN(videoEl.duration) || videoEl.duration <= 0) {
      // Browser native decoder cannot decode this container or codec.
      // Fallback seamlessly to high-speed server keyframe extractor!
      return await extractViaServerFallback(videoSource, options);
    }

    const duration = videoEl.duration;
    if (!duration || isNaN(duration) || duration <= 0) {
      throw new Error('Could not determine video duration.');
    }

    const videoWidth = videoEl.videoWidth || 640;
    const videoHeight = videoEl.videoHeight || 360;

    // Create thumbnail canvas for lightweight scene change scanning
    thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbSize;
    thumbCanvas.height = thumbSize;
    const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });
    if (!thumbCtx) throw new Error('Could not create 2D canvas context for thumbnails.');

    // Create sharpness analysis canvas
    sharpnessCanvas = document.createElement('canvas');
    sharpnessCanvas.width = sharpnessSampleSize;
    sharpnessCanvas.height = sharpnessSampleSize;
    const sharpnessCtx = sharpnessCanvas.getContext('2d', { willReadFrequently: true });
    if (!sharpnessCtx) throw new Error('Could not create 2D canvas context for sharpness.');

    // -------------------------------------------------------------------------
    // Phase 1: Lightweight Scene Change Detection
    // -------------------------------------------------------------------------
    const sceneCandidates: number[] = [];
    let prevThumbData: Uint8ClampedArray | null = null;
    let lastSceneTime = -minSceneInterval;

    const totalScanSteps = Math.max(1, Math.floor(duration / stepSeconds));
    let currentStep = 0;

    // Always include a timestamp near beginning
    const initialCandidate = Math.min(0.2, duration / 2);
    sceneCandidates.push(initialCandidate);
    lastSceneTime = initialCandidate;

    for (let t = 0; t < duration; t += stepSeconds) {
      if (isCancelled()) throw new Error('Video conversion cancelled by user.');

      currentStep++;
      if (currentStep % 4 === 0) {
        await yieldToMainThread();
        onProgress?.({
          phase: 'scanning',
          percent: Math.min(45, Math.round((t / duration) * 45)),
          statusText: `Scanning scenes... (${Math.round((t / duration) * 100)}%)`,
          currentTime: t,
          totalDuration: duration,
          candidatesFound: sceneCandidates.length,
          currentStep,
          totalSteps: totalScanSteps,
        });
      }

      await seekVideo(videoEl, t);

      // Render onto thumbnail canvas
      thumbCtx.drawImage(videoEl, 0, 0, thumbSize, thumbSize);
      const currentThumbImageData = thumbCtx.getImageData(0, 0, thumbSize, thumbSize);
      const currentThumbData = currentThumbImageData.data;

      if (prevThumbData) {
        const diff = computeFrameDifference(prevThumbData, currentThumbData);

        // If average difference exceeds threshold and minimum interval satisfied
        if (diff >= sceneThreshold && t - lastSceneTime >= minSceneInterval) {
          sceneCandidates.push(t);
          lastSceneTime = t;

          if (sceneCandidates.length >= maxKeyframes * 1.5) {
            break; // Cap candidate pool for efficiency
          }
        }
      }

      // Copy pixel data for next comparison
      prevThumbData = new Uint8ClampedArray(currentThumbData);
    }

    // Fallback: If very few scenes detected (e.g., continuous shot), sample evenly across video
    if (sceneCandidates.length < 6) {
      const needed = Math.min(6, Math.max(2, Math.floor(duration / 1.5)));
      const step = duration / (needed + 1);
      for (let i = 1; i <= needed; i++) {
        const time = i * step;
        if (!sceneCandidates.some((c) => Math.abs(c - time) < minSceneInterval)) {
          sceneCandidates.push(time);
        }
      }
      sceneCandidates.sort((a, b) => a - b);
    }

    // Limit candidates to reasonable maximum
    const refinedCandidates = sceneCandidates.slice(0, maxKeyframes);

    // -------------------------------------------------------------------------
    // Phase 2 & 3: Local Peak Search & High-Resolution Extraction
    // -------------------------------------------------------------------------
    fullCanvas = document.createElement('canvas');
    fullCanvas.width = videoWidth;
    fullCanvas.height = videoHeight;
    const fullCtx = fullCanvas.getContext('2d');
    if (!fullCtx) throw new Error('Could not create 2D canvas context for full resolution.');

    const finalKeyframes: ExtractedKeyframe[] = [];

    for (let cIdx = 0; cIdx < refinedCandidates.length; cIdx++) {
      if (isCancelled()) throw new Error('Video conversion cancelled by user.');

      const candidateTime = refinedCandidates[cIdx];
      const progressPercent = 45 + Math.round(((cIdx + 1) / refinedCandidates.length) * 50);

      onProgress?.({
        phase: 'refining',
        percent: progressPercent,
        statusText: `Optimizing sharpness for scene ${cIdx + 1} of ${refinedCandidates.length}...`,
        currentTime: candidateTime,
        totalDuration: duration,
        candidatesFound: refinedCandidates.length,
        currentStep: cIdx + 1,
        totalSteps: refinedCandidates.length,
      });

      await yieldToMainThread();

      // Local micro-search around candidate timestamp
      let bestTimestamp = candidateTime;
      let maxSharpness = -1;

      for (const offset of microSearchOffsets) {
        const microTime = Math.max(0, Math.min(candidateTime + offset, duration - 0.05));
        await seekVideo(videoEl, microTime);

        // Draw onto sharpness canvas and compute Laplacian variance
        sharpnessCtx.drawImage(videoEl, 0, 0, sharpnessSampleSize, sharpnessSampleSize);
        const sharpnessImgData = sharpnessCtx.getImageData(0, 0, sharpnessSampleSize, sharpnessSampleSize);
        const variance = computeLaplacianVariance(sharpnessImgData);

        if (variance > maxSharpness) {
          maxSharpness = variance;
          bestTimestamp = microTime;
        }
      }

      // Seek to optimal sharpest timestamp and capture high-resolution frame
      await seekVideo(videoEl, bestTimestamp);
      fullCtx.drawImage(videoEl, 0, 0, videoWidth, videoHeight);

      // Export high-resolution Blob and DataURL
      const dataUrl = fullCanvas.toDataURL(imageFormat, imageQuality);
      const blob = await new Promise<Blob>((resolve) => {
        fullCanvas?.toBlob(
          (b) => resolve(b || new Blob([], { type: imageFormat })),
          imageFormat,
          imageQuality
        );
      });

      finalKeyframes.push({
        timestamp: bestTimestamp,
        dataUrl,
        blob,
        sharpnessScore: maxSharpness,
        index: cIdx,
      });
    }

    onProgress?.({
      phase: 'complete',
      percent: 100,
      statusText: `Successfully extracted ${finalKeyframes.length} keyframes!`,
      candidatesFound: finalKeyframes.length,
    });

    return finalKeyframes;
  } finally {
    // -------------------------------------------------------------------------
    // Phase 4: Thorough Memory Cleanup
    // -------------------------------------------------------------------------
    if (videoUrl && typeof videoSource !== 'string') {
      try {
        URL.revokeObjectURL(videoUrl);
      } catch (e) {
        // Ignore
      }
    }

    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
        if (videoEl.parentNode) {
          videoEl.parentNode.removeChild(videoEl);
        }
      } catch (e) {
        // Ignore
      }
      videoEl = null;
    }

    // Clean up canvases to free graphic memory
    if (thumbCanvas) {
      thumbCanvas.width = 0;
      thumbCanvas.height = 0;
      thumbCanvas = null;
    }
    if (sharpnessCanvas) {
      sharpnessCanvas.width = 0;
      sharpnessCanvas.height = 0;
      sharpnessCanvas = null;
    }
    if (fullCanvas) {
      fullCanvas.width = 0;
      fullCanvas.height = 0;
      fullCanvas = null;
    }
  }
}
