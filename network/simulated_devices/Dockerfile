FROM python:3.11-alpine

RUN apk add --no-cache openssh-server bash shadow

# Generate SSH host keys
RUN ssh-keygen -A

# Configure SSH daemon for password authentication
RUN sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

# Copy CLI simulator script and network configs
COPY network/simulated_devices/cli_simulator.py /usr/local/bin/cli_simulator.py
RUN chmod +x /usr/local/bin/cli_simulator.py

RUN mkdir -p /etc/network
COPY network/simulated_devices/configs/ /etc/network/

# Create network users: cisco and admin with cli_simulator.py as default login shell
RUN useradd -m -s /usr/local/bin/cli_simulator.py cisco && \
    echo "cisco:cisco123" | chpasswd

RUN useradd -m -s /usr/local/bin/cli_simulator.py admin && \
    echo "admin:admin123" | chpasswd

COPY network/simulated_devices/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 22

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
