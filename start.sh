#!/bin/bash

echo "🔧 Installing GStreamer..."
apt-get update
apt-get install -y \
  gstreamer1.0-tools \
  gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad \
  gstreamer1.0-libav

echo "📦 Installing Node modules..."
npm install

echo "🚀 Starting server..."
npm start
