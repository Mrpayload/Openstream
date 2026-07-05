import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Plus, X, UserCircle2 } from 'lucide-react';

export default function ProfileSelectorModal({ 
  isOpen, 
  profiles, 
  activeProfileId, 
  onSelectProfile, 
  onAddProfile, 
  onClose,
  canClose 
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");

  if (!isOpen) return null;

  const handleAddSubmit = (e) => {
    e.preventDefault();
    if (newProfileName.trim()) {
      onAddProfile(newProfileName.trim());
      setNewProfileName("");
      setIsAdding(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="profile-modal-backdrop">
          <motion.div 
            className="profile-modal"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {canClose && (
              <button className="profile-close-btn" onClick={onClose} aria-label="Close">
                <X size={24} />
              </button>
            )}

            <h2>Who's watching?</h2>
            <p className="profile-subtitle">Save movies to your own personal profile on this device.</p>

            {!isAdding ? (
              <div className="profile-grid">
                {profiles.map((profile) => (
                  <button 
                    key={profile.id} 
                    className={`profile-card ${activeProfileId === profile.id ? 'active' : ''}`}
                    onClick={() => onSelectProfile(profile.id)}
                  >
                    <div className="profile-avatar" style={{ backgroundColor: profile.color }}>
                      <UserCircle2 size={48} color="#ffffff" strokeWidth={1.5} />
                    </div>
                    <span className="profile-name">{profile.name}</span>
                  </button>
                ))}

                <button className="profile-card add-profile" onClick={() => setIsAdding(true)}>
                  <div className="profile-avatar add-avatar">
                    <Plus size={36} color="#ffffff" />
                  </div>
                  <span className="profile-name">Add Profile</span>
                </button>
              </div>
            ) : (
              <form className="profile-add-form" onSubmit={handleAddSubmit}>
                <div className="form-group">
                  <label htmlFor="profileName">Profile Name</label>
                  <input 
                    id="profileName"
                    type="text" 
                    placeholder="e.g. Kids, John"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    autoFocus
                    maxLength={15}
                  />
                </div>
                <div className="form-actions">
                  <button type="button" className="ghost-btn" onClick={() => setIsAdding(false)}>Cancel</button>
                  <button type="submit" className="primary-btn" disabled={!newProfileName.trim()}>Create</button>
                </div>
              </form>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
