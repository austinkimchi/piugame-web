"use client";

import { Pause, Play } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

interface SongPreviewPlayButtonProps {
  previewUrl: string | null;
  title: string;
  className?: string;
}

const FADE_IN_MS = 100;

export function SongPreviewPlayButton({ previewUrl, title, className = "" }: SongPreviewPlayButtonProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const fadeFrameRef = useRef<number | null>(null);
  const volumeRef = useRef(0);
  const [hovered, setHovered] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  function setVolume(volume: number) {
    const nextVolume = Math.min(Math.max(volume, 0), 1);
    volumeRef.current = nextVolume;
    if (audioRef.current) {
      audioRef.current.volume = nextVolume;
    }
  }

  function cancelFade() {
    if (fadeFrameRef.current !== null) {
      window.cancelAnimationFrame(fadeFrameRef.current);
      fadeFrameRef.current = null;
    }
  }

  function fadeTo(targetVolume: number, durationMs: number, onComplete?: () => void) {
    cancelFade();
    const startVolume = volumeRef.current;
    const startTime = window.performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / durationMs, 1);
      const eased = 1 - (1 - progress) ** 2;
      setVolume(startVolume + (targetVolume - startVolume) * eased);

      if (progress < 1) {
        fadeFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      fadeFrameRef.current = null;
      onComplete?.();
    };

    fadeFrameRef.current = window.requestAnimationFrame(tick);
  }

  function stopPreview() {
    const audio = audioRef.current;
    if (!audio) {
      setPlaying(false);
      return;
    }

    cancelFade();
    audio.pause();
    setPlaying(false);
  }

  async function togglePreview() {
    if (!previewUrl) {
      return;
    }

    if (playing) {
      stopPreview();
      return;
    }

    const audio = audioRef.current ?? new Audio(previewUrl);
    audioRef.current = audio;
    audio.loop = false;
    if (audioUrlRef.current !== previewUrl) {
      audio.src = previewUrl;
      audio.currentTime = 0;
      audioUrlRef.current = previewUrl;
    }
    setVolume(0);

    try {
      await audio.play();
      setPlaying(true);
      fadeTo(1, FADE_IN_MS);
    } catch {
      stopPreview();
    }
  }

  function seekPreview(event: ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const nextTime = Number(event.target.value);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  useEffect(() => {
    if (!previewUrl) {
      return;
    }

    const audio = new Audio(previewUrl);
    audio.preload = "metadata";
    audio.loop = false;
    audio.volume = 0;
    audioRef.current = audio;
    audioUrlRef.current = previewUrl;
    volumeRef.current = 0;

    function updateTime() {
      setCurrentTime(audio.currentTime);
    }

    function updateDuration() {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    }

    function finishPlayback() {
      setPlaying(false);
      volumeRef.current = 0;
      audio.volume = 0;
      setCurrentTime(0);
      audio.currentTime = 0;
    }

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("durationchange", updateDuration);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("ended", finishPlayback);
    audio.load();

    return () => {
      if (fadeFrameRef.current !== null) {
        window.cancelAnimationFrame(fadeFrameRef.current);
        fadeFrameRef.current = null;
      }
      audio.pause();
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("durationchange", updateDuration);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("ended", finishPlayback);
      audio.removeAttribute("src");
      audio.load();
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      cancelFade();
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  if (!previewUrl) {
    return null;
  }

  return (
    <div
      className={`absolute inset-0 z-20 ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setHovered(false);
        }
      }}
    >
      <AnimatePresence>
        {hovered || playing ? (
          <motion.button
            aria-label={`${playing ? "Pause" : "Play"} ${title} preview`}
            className="absolute left-1/2 top-1/2 inline-flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-transparent text-[#24bd55] drop-shadow-[0_2px_0_rgba(255,255,255,0.9)] transition hover:scale-105 hover:text-[#43d872]"
            initial={{ opacity: 0, scale: 0.82 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.82 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void togglePreview();
            }}
          >
            {playing ? (
              <Pause aria-hidden="true" color="#24bd55" fill="#24bd55" size={29} />
            ) : (
              <Play aria-hidden="true" color="#24bd55" fill="#24bd55" size={31} className="ml-1" />
            )}
          </motion.button>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {(hovered || playing) && duration > 0 ? (
          <motion.input
            aria-label={`${title} preview position`}
            className="preview-seek-slider absolute bottom-4 left-4 right-4 h-7"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            max={duration}
            min={0}
            step="0.01"
            type="range"
            value={Math.min(currentTime, duration)}
            onChange={seekPreview}
            onClick={(event) => event.stopPropagation()}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
