import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('ip_config',ROOT/'scripts/configure-client-ip.py')
config=importlib.util.module_from_spec(spec);spec.loader.exec_module(config)

class ClientIpConfigTests(unittest.TestCase):
    def test_modes_and_header_replacement(self):
        template=(ROOT/'docker/nginx.conf').read_text()
        ranges=(ROOT/'docker/cloudflare-ranges.txt').read_text()
        for mode in config.MODES:
            text=config.generate(mode,template,ranges,'172.28.12.1','127.0.0.1')
            self.assertNotIn('$proxy_add_x_forwarded_for',text)
            self.assertEqual(text.count('proxy_set_header X-Forwarded-For $remote_addr;'),3)
            self.assertIn('X-FullPassword-Client-IP-Mode '+mode,text)
        direct=config.generate('direct',template,ranges)
        self.assertNotIn('set_real_ip_from',direct)
        self.assertIn('proxy_set_header CF-Connecting-IP "";',direct)
    def test_tunnel_fail_closed(self):
        template=(ROOT/'docker/nginx.conf').read_text()
        for peer,bind in [(None,'127.0.0.1'),('0.0.0.0','127.0.0.1'),('8.8.8.8','127.0.0.1'),('172.28.12.1','0.0.0.0')]:
            with self.assertRaises(ValueError):config.generate('cloudflare_tunnel',template,'',peer,bind)
    def test_invalid_ranges_and_atomic_refresh(self):
        for value in ['', '<html>error</html>', '0.0.0.0/0', '::/0', '127.0.0.1/32', '1.2.3.4', '192.168.1.1/24']:
            with self.assertRaises(ValueError):config.parse_ranges(value)
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'ranges.txt';file.write_text('ORIGINAL_VALID_SNAPSHOT')
            class Response:
                status=200
                def __enter__(self):return self
                def __exit__(self,*args):pass
                def read(self,*args):return b'<html>error</html>'
            with patch.object(config.urllib.request,'urlopen',return_value=Response()):
                with self.assertRaises(ValueError):config.refresh_ranges(file)
            self.assertEqual(file.read_text(),'ORIGINAL_VALID_SNAPSHOT')
            config.atomic_write(file,'VALIDATED_REPLACEMENT')
            self.assertEqual(file.read_text(),'VALIDATED_REPLACEMENT')

if __name__=='__main__':unittest.main()
