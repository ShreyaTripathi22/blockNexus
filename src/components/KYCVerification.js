import React, { useState } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { storage, db } from '../firebase/config';

const KYCVerification = ({ user, onKYCSubmit, onClose }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState({});
  
  const [kycData, setKycData] = useState({
    aadharNumber: '',
    panNumber: '',
    aadharFile: null,
    panFile: null,
    aadharPreview: null,
    panPreview: null,
    fullName: '',
    dateOfBirth: '',
    address: ''
  });

  // Aadhar number validation
  const validateAadhar = (number) => {
    const aadharRegex = /^\d{12}$/;
    return aadharRegex.test(number.replace(/\s/g, ''));
  };

  // PAN number validation
  const validatePAN = (number) => {
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    return panRegex.test(number.toUpperCase());
  };

  // File validation
  const validateFile = (file, type) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!file) {
      return `${type} image is required`;
    }

    if (!allowedTypes.includes(file.type)) {
      return `${type} must be a valid image (JPEG, PNG, WEBP)`;
    }

    if (file.size > maxSize) {
      return `${type} size must be less than 5MB`;
    }

    return null;
  };

  // Handle file selection
  const handleFileChange = (e, type) => {
    const file = e.target.files[0];
    if (file) {
      const error = validateFile(file, type);
      if (error) {
        setErrors(prev => ({ ...prev, [type]: error }));
        return;
      }

      // Clear previous errors
      setErrors(prev => ({ ...prev, [type]: null }));

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setKycData(prev => ({
          ...prev,
          [`${type}File`]: file,
          [`${type}Preview`]: e.target.result
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setKycData(prev => ({ ...prev, [name]: value }));

    // Clear errors on input change
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: null }));
    }
  };

  // Validate step 1 (Document Numbers)
  const validateStep1 = () => {
    const newErrors = {};

    if (!kycData.aadharNumber) {
      newErrors.aadharNumber = 'Aadhar number is required';
    } else if (!validateAadhar(kycData.aadharNumber)) {
      newErrors.aadharNumber = 'Invalid Aadhar number format (12 digits)';
    }

    if (!kycData.panNumber) {
      newErrors.panNumber = 'PAN number is required';
    } else if (!validatePAN(kycData.panNumber)) {
      newErrors.panNumber = 'Invalid PAN format (e.g., ABCDE1234F)';
    }

    if (!kycData.fullName.trim()) {
      newErrors.fullName = 'Full name is required';
    }

    if (!kycData.dateOfBirth) {
      newErrors.dateOfBirth = 'Date of birth is required';
    }

    if (!kycData.address.trim()) {
      newErrors.address = 'Address is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Validate step 2 (Document Upload)
  const validateStep2 = () => {
    const newErrors = {};

    const aadharError = validateFile(kycData.aadharFile, 'Aadhar');
    const panError = validateFile(kycData.panFile, 'PAN');

    if (aadharError) newErrors.aadhar = aadharError;
    if (panError) newErrors.pan = panError;

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Upload file to Firebase Storage
  const uploadFile = async (file, path) => {
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    return await getDownloadURL(snapshot.ref);
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (currentStep === 1) {
      if (validateStep1()) {
        setCurrentStep(2);
      }
      return;
    }

    if (currentStep === 2) {
      if (!validateStep2()) return;

      setIsUploading(true);
      try {
        // Upload documents to Firebase Storage
        const aadharURL = await uploadFile(
          kycData.aadharFile,
          `kyc/${user.walletAddress}/aadhar_${Date.now()}.${kycData.aadharFile.name.split('.').pop()}`
        );

        const panURL = await uploadFile(
          kycData.panFile,
          `kyc/${user.walletAddress}/pan_${Date.now()}.${kycData.panFile.name.split('.').pop()}`
        );

        // Save KYC data to Firestore
        const kycDocRef = doc(db, 'kyc', user.walletAddress);
        await setDoc(kycDocRef, {
          walletAddress: user.walletAddress,
          aadharNumber: kycData.aadharNumber.replace(/\s/g, ''),
          panNumber: kycData.panNumber.toUpperCase(),
          fullName: kycData.fullName,
          dateOfBirth: kycData.dateOfBirth,
          address: kycData.address,
          aadharImageURL: aadharURL,
          panImageURL: panURL,
          verificationStatus: 'pending',
          submittedAt: new Date().toISOString(),
          approvedAt: null,
          rejectedAt: null,
          rejectionReason: null
        });

        // Update user document with KYC status
        const userDocRef = doc(db, 'users', user.walletAddress);
        await updateDoc(userDocRef, {
          kycStatus: 'pending',
          kycSubmittedAt: new Date().toISOString()
        });

        // Notify parent component
        onKYCSubmit({
          status: 'pending',
          submittedAt: new Date().toISOString()
        });

        setCurrentStep(3); // Success step
      } catch (error) {
        console.error('KYC submission error:', error);
        setErrors({ submit: 'Failed to submit KYC documents. Please try again.' });
      } finally {
        setIsUploading(false);
      }
    }
  };

  // Format Aadhar number with spaces
  const formatAadhar = (value) => {
    const cleaned = value.replace(/\s/g, '');
    const formatted = cleaned.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
    return formatted;
  };

  return (
    <div className="modal-overlay">
      <div className="kyc-modal">
        <div className="modal__header">
          <h2>🔐 KYC Verification</h2>
          <p>Complete your identity verification to access all features</p>
          <button className="modal__close" onClick={onClose}>×</button>
        </div>

        {/* Progress Indicator */}
        <div className="kyc__progress">
          <div className={`progress-step ${currentStep >= 1 ? 'active' : ''}`}>1</div>
          <div className={`progress-line ${currentStep >= 2 ? 'active' : ''}`}></div>
          <div className={`progress-step ${currentStep >= 2 ? 'active' : ''}`}>2</div>
          <div className={`progress-line ${currentStep >= 3 ? 'active' : ''}`}></div>
          <div className={`progress-step ${currentStep >= 3 ? 'active' : ''}`}>3</div>
        </div>

        <div className="kyc__content">
          {currentStep === 1 && (
            <div className="kyc-step">
              <h3>📋 Personal Information</h3>
              <p>Enter your details as they appear on your documents</p>

              <div className="form-group">
                <label>Full Name (as per Aadhar) *</label>
                <input
                  type="text"
                  name="fullName"
                  value={kycData.fullName}
                  onChange={handleInputChange}
                  placeholder="Enter your full name"
                />
                {errors.fullName && <span className="error-message">{errors.fullName}</span>}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Aadhar Number *</label>
                  <input
                    type="text"
                    name="aadharNumber"
                    value={formatAadhar(kycData.aadharNumber)}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\s/g, '').slice(0, 12);
                      setKycData(prev => ({ ...prev, aadharNumber: value }));
                    }}
                    placeholder="1234 5678 9012"
                    maxLength="14"
                  />
                  {errors.aadharNumber && <span className="error-message">{errors.aadharNumber}</span>}
                </div>

                <div className="form-group">
                  <label>PAN Number *</label>
                  <input
                    type="text"
                    name="panNumber"
                    value={kycData.panNumber.toUpperCase()}
                    onChange={(e) => {
                      const value = e.target.value.toUpperCase().slice(0, 10);
                      setKycData(prev => ({ ...prev, panNumber: value }));
                    }}
                    placeholder="ABCDE1234F"
                    maxLength="10"
                  />
                  {errors.panNumber && <span className="error-message">{errors.panNumber}</span>}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Date of Birth *</label>
                  <input
                    type="date"
                    name="dateOfBirth"
                    value={kycData.dateOfBirth}
                    onChange={handleInputChange}
                  />
                  {errors.dateOfBirth && <span className="error-message">{errors.dateOfBirth}</span>}
                </div>
              </div>

              <div className="form-group">
                <label>Address *</label>
                <textarea
                  name="address"
                  value={kycData.address}
                  onChange={handleInputChange}
                  placeholder="Enter your complete address as per Aadhar"
                  rows="3"
                />
                {errors.address && <span className="error-message">{errors.address}</span>}
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="kyc-step">
              <h3>📸 Document Upload</h3>
              <p>Upload clear images of your Aadhar and PAN cards</p>

              <div className="upload-section">
                <div className="upload-group">
                  <h4>🆔 Aadhar Card *</h4>
                  <div className="file-upload">
                    <input
                      type="file"
                      id="aadhar-upload"
                      accept="image/*"
                      onChange={(e) => handleFileChange(e, 'aadhar')}
                      hidden
                    />
                    <label htmlFor="aadhar-upload" className="upload-label">
                      {kycData.aadharPreview ? (
                        <div className="file-preview">
                          <img src={kycData.aadharPreview} alt="Aadhar preview" />
                          <div className="upload-overlay">
                            <span>Click to change</span>
                          </div>
                        </div>
                      ) : (
                        <div className="upload-placeholder">
                          <div className="upload-icon">📁</div>
                          <p>Click to upload Aadhar image</p>
                          <small>JPEG, PNG, WEBP (Max 5MB)</small>
                        </div>
                      )}
                    </label>
                    {errors.aadhar && <span className="error-message">{errors.aadhar}</span>}
                  </div>
                </div>

                <div className="upload-group">
                  <h4>🏦 PAN Card *</h4>
                  <div className="file-upload">
                    <input
                      type="file"
                      id="pan-upload"
                      accept="image/*"
                      onChange={(e) => handleFileChange(e, 'pan')}
                      hidden
                    />
                    <label htmlFor="pan-upload" className="upload-label">
                      {kycData.panPreview ? (
                        <div className="file-preview">
                          <img src={kycData.panPreview} alt="PAN preview" />
                          <div className="upload-overlay">
                            <span>Click to change</span>
                          </div>
                        </div>
                      ) : (
                        <div className="upload-placeholder">
                          <div className="upload-icon">📁</div>
                          <p>Click to upload PAN image</p>
                          <small>JPEG, PNG, WEBP (Max 5MB)</small>
                        </div>
                      )}
                    </label>
                    {errors.pan && <span className="error-message">{errors.pan}</span>}
                  </div>
                </div>
              </div>

              <div className="kyc-guidelines">
                <h4>📋 Upload Guidelines:</h4>
                <ul>
                  <li>✅ Ensure documents are clearly visible and readable</li>
                  <li>✅ All four corners of the document should be visible</li>
                  <li>✅ No blur, glare, or shadows on the document</li>
                  <li>✅ File size should be less than 5MB</li>
                  <li>❌ Do not upload screenshots or photocopies</li>
                </ul>
              </div>

              {errors.submit && <div className="error-message">{errors.submit}</div>}
            </div>
          )}

          {currentStep === 3 && (
            <div className="kyc-step success-step">
              <div className="success-icon">✅</div>
              <h3>KYC Documents Submitted Successfully!</h3>
              <p>Your documents have been submitted for verification. This process typically takes 1-3 business days.</p>
              
              <div className="status-info">
                <div className="status-item">
                  <span className="status-label">Status:</span>
                  <span className="status-value pending">Pending Review</span>
                </div>
                <div className="status-item">
                  <span className="status-label">Submitted:</span>
                  <span className="status-value">{new Date().toLocaleDateString()}</span>
                </div>
              </div>

              <div className="next-steps">
                <h4>What happens next?</h4>
                <ul>
                  <li>Our team will review your documents</li>
                  <li>You'll receive an email notification once verified</li>
                  <li>You can check your verification status in your profile</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="kyc__footer">
          {currentStep < 3 && (
            <div className="form-buttons">
              {currentStep > 1 && (
                <button 
                  className="btn btn--secondary" 
                  onClick={() => setCurrentStep(prev => prev - 1)}
                  disabled={isUploading}
                >
                  ← Previous
                </button>
              )}
              <button 
                className="btn btn--primary" 
                onClick={handleSubmit}
                disabled={isUploading}
              >
                {isUploading ? 'Uploading...' : currentStep === 1 ? 'Next →' : 'Submit KYC'}
              </button>
            </div>
          )}
          {currentStep === 3 && (
            <button className="btn btn--primary" onClick={onClose}>
              Continue to Dashboard
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default KYCVerification;