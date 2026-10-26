import { Injectable } from '@angular/core'
import * as net from 'net'

export interface Tunnel {
    id: string
    serverKey: string
    serverName: string
    localPort: number
    remoteHost: string
    remotePort: number
    connections: number
}

interface TunnelHandle {
    tunnel: Tunnel
    server: net.Server
    sockets: Set<net.Socket>
}

/**
 * Local port forwards (localhost:L → remoteHost:R on the server) carried
 * over an open Tabby SSH session. Lives at app level, so tunnels keep
 * working when the panel is closed; they stop with their SSH session.
 */
@Injectable({ providedIn: 'root' })
export class TunnelService {
    private handles: TunnelHandle[] = []

    get tunnels (): Tunnel[] {
        return this.handles.map(h => h.tunnel)
    }

    forServer (serverKey: string): Tunnel[] {
        return this.tunnels.filter(t => t.serverKey === serverKey)
    }

    async open (session: any, serverKey: string, serverName: string, localPort: number, remoteHost: string, remotePort: number): Promise<Tunnel> {
        const tunnel: Tunnel = {
            id: `${serverKey}:${localPort}`,
            serverKey, serverName, localPort, remoteHost, remotePort,
            connections: 0,
        }
        const sockets = new Set<net.Socket>()
        const server = net.createServer(socket => this.forward(session, tunnel, socket, sockets))
        await new Promise<void>((resolve, reject) => {
            server.once('error', (e: any) => reject(new Error(e.code === 'EADDRINUSE'
                ? `Порт ${localPort} на этом компьютере уже занят`
                : e.message)))
            server.listen(localPort, '127.0.0.1', () => resolve())
        })
        const handle = { tunnel, server, sockets }
        this.handles.push(handle)
        session.willDestroy$?.subscribe(() => this.close(tunnel.id))
        return tunnel
    }

    close (id: string): void {
        const handle = this.handles.find(h => h.tunnel.id === id)
        if (!handle) {
            return
        }
        handle.sockets.forEach(s => s.destroy())
        handle.server.close()
        this.handles = this.handles.filter(h => h !== handle)
    }

    /** The preferred local port if it's free (and unprivileged), otherwise one picked by the OS */
    freePort (preferred: number): Promise<number> {
        const listen = (port: number) => new Promise<number | null>(resolve => {
            const probe = net.createServer()
            probe.once('error', () => resolve(null))
            probe.listen(port, '127.0.0.1', () => {
                const actual = (probe.address() as net.AddressInfo).port
                probe.close(() => resolve(actual))
            })
        })
        return (preferred > 1024 ? listen(preferred) : Promise.resolve(null))
            .then(port => port ?? listen(0))
            .then(port => port ?? Promise.reject(new Error('Нет свободных портов')))
    }

    private forward (session: any, tunnel: Tunnel, socket: net.Socket, sockets: Set<net.Socket>): void {
        socket.pause()
        sockets.add(socket)
        tunnel.connections++
        socket.once('close', () => {
            sockets.delete(socket)
            tunnel.connections--
        })
        const ssh = session.ssh
        ssh.openTCPForwardChannel({
            addressToConnectTo: tunnel.remoteHost,
            portToConnectTo: tunnel.remotePort,
            originatorAddress: socket.remoteAddress || '127.0.0.1',
            originatorPort: socket.remotePort || 0,
        }).then((newChannel: any) => ssh.activateChannel(newChannel)).then((channel: any) => {
            channel.data$.subscribe((data: Uint8Array) => socket.write(Buffer.from(data)))
            channel.eof$.subscribe(() => socket.end())
            channel.closed$.subscribe(() => socket.destroy())
            socket.on('data', data => channel.write(new Uint8Array(data)).catch(() => socket.destroy()))
            socket.on('end', () => channel.eof().catch(() => null))
            socket.on('close', () => channel.close().catch(() => null))
            socket.resume()
        }).catch(() => socket.destroy())
    }
}
