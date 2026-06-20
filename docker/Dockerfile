FROM node:20-alpine

# Install system deps for sharp
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    vips-dev

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built dist
COPY dist/ ./dist/

# Create output directory
RUN mkdir -p /root/imageforge-output

# Make CLI available globally in container
RUN npm link

# Set environment hints
ENV IMAGEFORGE_OUTPUT_DIR=/root/imageforge-output
ENV IMAGEFORGE_NO_BANNER=false

# Pass API keys as env vars:
# docker run -e IMAGEFORGE_OPENAI_API_KEY=sk-... imageforge-cli generate "prompt"
ENTRYPOINT ["imageforge"]
CMD ["--help"]
