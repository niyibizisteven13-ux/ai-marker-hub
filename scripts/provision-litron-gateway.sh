#!/usr/bin/env bash
set -euo pipefail
umask 077

interface=litron-wg
network=10.77.77.0/24
port=51820
config="/etc/wireguard/$interface.conf"
managed="/etc/wireguard/$interface.managed"
peer_key="${1:-}"
peer_host="${2:-}"

if (( EUID != 0 )); then
  echo 'Run with root privileges.' >&2
  exit 1
fi
exec 9>/run/lock/litron-wireguard.lock
flock 9

if [[ -n "$peer_key" || -n "$peer_host" ]]; then
  if [[ ! "$peer_key" =~ ^[A-Za-z0-9+/]{43}=$ || ! "$peer_host" =~ ^[0-9]{1,3}$ ]] ||
    (( 10#$peer_host < 2 || 10#$peer_host > 254 )); then
    echo 'Provide a WireGuard public key and an unused client number from 2 to 254.' >&2
    exit 1
  fi
  peer_address="10.77.77.$((10#$peer_host))/32"
fi

if [[ -e "$config" && ! -e "$managed" ]]; then
  echo "An unmanaged $interface configuration already exists." >&2
  exit 1
fi
if ! command -v wg-quick >/dev/null || ! command -v iptables >/dev/null; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard-tools iptables
fi

if [[ ! -e "$config" ]]; then
  if ip link show "$interface" >/dev/null 2>&1 ||
    [[ -n "$(ss -H -lun "sport = :$port")" ]] ||
    [[ -n "$(ip -4 route show match "$network" | awk '$1 != "default"')" ]] ||
    [[ -n "$(ip -4 route show root "$network")" ]]; then
    echo 'The Litron interface, UDP port, or VPN subnet is already in use.' >&2
    exit 1
  fi
  uplink="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "dev") {print $(i+1); exit}}')"
  if [[ ! "$uplink" =~ ^[a-zA-Z0-9_.-]+$ ]]; then
    echo 'Could not identify the IPv4 uplink interface.' >&2
    exit 1
  fi
  install -d -m 700 /etc/wireguard
  private_key="$(wg genkey)"
  temp_config="$(mktemp /etc/wireguard/.litron.XXXXXX)"
  trap 'rm -f -- "$temp_config"' EXIT
  cat > "$temp_config" <<CONFIG
[Interface]
Address = 10.77.77.1/24
ListenPort = $port
PrivateKey = $private_key
SaveConfig = true
PostUp = iptables -w -N LITRON_EGRESS; for cidr in 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16; do iptables -w -A LITRON_EGRESS -d "\$cidr" -j DROP; done; iptables -w -A LITRON_EGRESS -o $uplink -s $network -j ACCEPT; iptables -w -A LITRON_EGRESS -j DROP
PostUp = iptables -w -I INPUT -i %i -j DROP; iptables -w -I FORWARD -i %i -j LITRON_EGRESS; iptables -w -I FORWARD -i $uplink -o %i -d $network -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT; iptables -w -t nat -A POSTROUTING -s $network -o $uplink -j MASQUERADE
PostDown = iptables -w -D INPUT -i %i -j DROP; iptables -w -D FORWARD -i %i -j LITRON_EGRESS; iptables -w -D FORWARD -i $uplink -o %i -d $network -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT; iptables -w -t nat -D POSTROUTING -s $network -o $uplink -j MASQUERADE; iptables -w -F LITRON_EGRESS; iptables -w -X LITRON_EGRESS
CONFIG
  touch "$managed"
  mv -- "$temp_config" "$config"
fi

printf 'net.ipv4.ip_forward = 1\n' > /etc/sysctl.d/91-litron-wireguard.conf
sysctl -p /etc/sysctl.d/91-litron-wireguard.conf
systemctl enable --now "wg-quick@$interface"
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow "$port/udp" comment 'Litron WireGuard'
fi

if [[ -n "$peer_key" ]]; then
  while read -r key address; do
    if [[ "$address" == "$peer_address" && "$key" != "$peer_key" ]]; then
      echo "The VPN address $peer_address is already assigned." >&2
      exit 1
    fi
    if [[ "$key" == "$peer_key" && "$address" != "$peer_address" ]]; then
      echo 'This public key already belongs to a different VPN address.' >&2
      exit 1
    fi
  done < <(wg show "$interface" allowed-ips)
  wg set "$interface" peer "$peer_key" allowed-ips "$peer_address"
  wg-quick save "$interface"
  printf 'Client IPv4 address: %s\n' "$peer_address"
fi

printf 'Gateway public key: %s\n' "$(wg show "$interface" public-key)"
printf 'Gateway UDP port: %s\n' "$(wg show "$interface" listen-port)"
