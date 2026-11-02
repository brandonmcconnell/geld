import {describe,expect,it} from 'vitest';
import {publicAddress} from './public-fetch';
describe('public reachability boundary',()=>{it('rejects private, loopback, link-local, mapped and transition ranges',()=>{for(const address of ['127.0.0.1','10.0.0.1','172.16.1.2','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2002:7f00:1::','2001:db8::1'])expect(publicAddress(address),address).toBe(false);for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])expect(publicAddress(address),address).toBe(true);});});
