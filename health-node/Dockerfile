FROM node:18-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# Hugging Face Spaces expects port 7860
ENV PORT=7860

EXPOSE 7860

CMD ["node", "index.js"]
