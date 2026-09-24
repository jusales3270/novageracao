# Chromium precisa das bibliotecas do sistema: usar a imagem da própria Playwright
# evita caçar dependência em imagem slim.
FROM mcr.microsoft.com/playwright:v1.56.0-noble

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npx playwright install chromium

COPY tsconfig.json ./
COPY src ./src
COPY db ./db
COPY scripts ./scripts
COPY public ./public
COPY fixtures ./fixtures
RUN npm i -g tsx@4

# roda sem privilégio e com volume próprio para os PDFs
RUN mkdir -p /arquivos && chown -R pwuser:pwuser /app /arquivos
USER pwuser
ENV ARQUIVOS_DIR=/arquivos
VOLUME ["/arquivos"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORTA||3000)+'/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["tsx", "src/api/server.ts"]
