const { exec } = require('child_process');

// POST /api/system/update - Dispara a atualização do sistema
const updateSystem = async (req, res) => {
  try {
    // Apenas admins podem atualizar o sistema
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem atualizar o sistema' });
    }

    // Retorna a resposta imediatamente para o frontend
    res.status(200).json({ 
      message: 'Atualização iniciada. O sistema será reiniciado em breve.',
      estimatedTime: 30 // Segundos estimados para o frontend aguardar
    });

    // Executa o script de atualização em background (fire and forget)
    // Usamos nohup/setsid equivalente no Node executando o comando desanexado
    // ou apenas um setTimeout para garantir que a resposta HTTP foi enviada
    setTimeout(() => {
      console.log('Iniciando WebUpdater...');
      
      // Técnica de Contêiner Efêmero Detached:
      // Disparamos um container independente em background que executará a atualização.
      // O sleep 3 garante que este container (backend atual) tenha tempo de enviar a resposta HTTP.
      // A imagem 'fullpassword-backend' já possui o git e o docker-cli-compose instalados.
      const updateCommand = `docker run --rm -d \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v /opt/fullpassword:/opt/fullpassword \
        -w /opt/fullpassword \
        fullpassword-backend \
        sh -c "sleep 3 && git config --global --add safe.directory /opt/fullpassword && git pull origin main && docker compose up -d --build"`;

      exec(updateCommand, (error, stdout, stderr) => {
        if (error) {
          console.error(`Erro na atualização: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`Stderr da atualização: ${stderr}`);
        }
        console.log(`Stdout da atualização: ${stdout}`);
      });
    }, 1000); // Aguarda 1 segundo para enviar a resposta antes de iniciar

  } catch (error) {
    console.error('Erro ao iniciar atualização:', error);
    res.status(500).json({ error: 'Erro interno ao iniciar atualização' });
  }
};

module.exports = {
  updateSystem
};
