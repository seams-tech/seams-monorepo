import React from 'react';
import SeamsProfileSettingsButton, {
  type SettingsPresentation,
} from '../SeamsProfileSettingsButton';

/**
 * Inline wrapper for AccountMenuButton inside the passkey demo area.
 */
export const NavbarProfileOverlay: React.FC<{ presentation?: SettingsPresentation }> = ({
  presentation,
}) => {
  return (
    <div className="passkey-demo__profile-button-slot">
      <SeamsProfileSettingsButton className="navbar-profile-button" presentation={presentation} />
    </div>
  );
};

export default NavbarProfileOverlay;
