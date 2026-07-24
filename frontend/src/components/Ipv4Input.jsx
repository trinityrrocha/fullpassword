import IpCidrInput from './IpCidrInput';
import { sanitizeIpv4Input } from '../utils/ipCidr';

export default function Ipv4Input({ label = 'IPv4', ...props }) {
  return (
    <IpCidrInput
      {...props}
      label={label}
      maxLength={15}
      neutralMessage="IPv4 sem CIDR."
      sanitize={sanitizeIpv4Input}
    />
  );
}
