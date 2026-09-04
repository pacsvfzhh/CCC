import { Admin } from '../../types';
import AdminGroupConfiguration from './AdminGroupConfiguration';
import SecondaryAdminConfiguration from './SecondaryAdminConfiguration';

interface SystemConfigurationProps {
  admin: Admin;
}

export default function SystemConfiguration({ admin }: SystemConfigurationProps) {
  if (admin.role === 'super_admin') {
    return <AdminGroupConfiguration admin={admin} />;
  }

  return <SecondaryAdminConfiguration admin={admin} />;
}
