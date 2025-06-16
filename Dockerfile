FROM node:20-slim

# Avoid tzdata prompt
ENV DEBIAN_FRONTEND=noninteractive

# Install GStreamer + ffmpeg + x264 encoder + basic tools
RUN apt-get update && apt-get install -y \
  gstreamer1.0-tools \
  gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-ugly \
  gstreamer1.0-libav \
  ffmpeg \
  && apt-get clean

# Set working dir
WORKDIR /app

# Copy dependencies and install
COPY package*.json ./
RUN npm install

# Copy rest of the code
COPY . .

# Expose port
EXPOSE 5000

# Start app
CMD ["npm", "start"]
