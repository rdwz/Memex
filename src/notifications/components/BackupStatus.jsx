import React from 'react'
import PropTypes from 'prop-types'
import { BackupSuccess, BackupFailed, AutomaticBackup } from './BackupOverlay'
import ActionButton from './ActionButton'

const styles = require('./BackupStatus.css')

const BackupStatus = props => {
    return (
        <div>
            <div
                className={styles.container}
                onMouseEnter={props.onMouseEnter}
                onMouseLeave={props.onMouseLeave}
            >
                <div className={styles.header}>Backup Status</div>
                <div>
                    {props.backupState.state === 'success' ||
                    props.backupState.state === 'autoBackup' ? (
                        <img src={props.checkedIcon} className={styles.icon} />
                    ) : (
                        <img src={props.crossIcon} className={styles.icon} />
                    )}
                </div>
                <div className={[styles.backupOverlay]}>
                    {props.hover &&
                        props.backupTimes && (
                            <div>
                                {props.backupState.state === 'success' && (
                                    <BackupSuccess
                                        message={props.backupState.message}
                                        header={props.backupState.header}
                                        lastBackup={
                                            props.backupTimes.lastBackup
                                        }
                                        nextBackup={
                                            props.backupTimes.nextBackup
                                        }
                                        automaticBackup={props.automaticBackup}
                                        onAutomaticBackupSelect={
                                            props.onAutomaticBackupSelect
                                        }
                                    >
                                        <ActionButton
                                            handleClick={() =>
                                                (window.location.href =
                                                    '/options.html#/backup')
                                            }
                                        >
                                            {' '}
                                            Backup Now{' '}
                                        </ActionButton>
                                    </BackupSuccess>
                                )}
                                {props.backupState.state === 'fail' && (
                                    <BackupFailed
                                        errorMessage={props.backupState.message}
                                        header={props.backupState.header}
                                        lastBackup={
                                            props.backupTimes.lastBackup
                                        }
                                        nextBackup={
                                            props.backupTimes.nextBackup
                                        }
                                        crossIcon={props.crossIcon}
                                        automaticBackup={props.automaticBackup}
                                        onAutomaticBackupSelect={
                                            props.onAutomaticBackupSelect
                                        }
                                    >
                                        <ActionButton
                                            handleClick={() =>
                                                (window.location.href =
                                                    '/options.html#/backup')
                                            }
                                        >
                                            {' '}
                                            Backup Now{' '}
                                        </ActionButton>
                                    </BackupFailed>
                                )}
                                {props.backupState.state === 'autoBackup' && (
                                    <AutomaticBackup
                                        header={props.backupState.header}
                                        onAutomaticBackupSelect={
                                            props.onAutomaticBackupSelect
                                        }
                                        automaticBackup={props.automaticBackup}
                                    >
                                        <div className={styles.paymentOptions}>
                                            <div>
                                                <label>
                                                    <input
                                                        type="radio"
                                                        checked={
                                                            props.billingPeriod ===
                                                            'yearly'
                                                        }
                                                        // disabled={mode !== 'automatic'}
                                                        onChange={() =>
                                                            props.onBillingPeriodChange(
                                                                'yearly',
                                                            )
                                                        }
                                                    />
                                                    <span
                                                        className={styles.price}
                                                    >
                                                        12 &euro;
                                                    </span>
                                                    <span
                                                        className={
                                                            styles.period
                                                        }
                                                    >
                                                        {' '}
                                                        yearly
                                                    </span>
                                                </label>
                                            </div>
                                            <div>
                                                <label>
                                                    <input
                                                        type="radio"
                                                        checked={
                                                            props.billingPeriod ===
                                                            'monthly'
                                                        }
                                                        // disabled={mode !== 'automatic'}
                                                        onChange={() =>
                                                            props.onBillingPeriodChange(
                                                                'monthly',
                                                            )
                                                        }
                                                    />
                                                    <span
                                                        className={styles.price}
                                                    >
                                                        1,5 &euro;
                                                    </span>
                                                    <span
                                                        className={
                                                            styles.period
                                                        }
                                                    >
                                                        {' '}
                                                        monthly
                                                    </span>
                                                </label>
                                            </div>
                                        </div>
                                        <ActionButton
                                            handleClick={() =>
                                                (window.location.href =
                                                    props.paymentUrl)
                                            }
                                        >
                                            {' '}
                                            Upgrade now{' '}
                                        </ActionButton>
                                    </AutomaticBackup>
                                )}
                            </div>
                        )}
                </div>
            </div>
        </div>
    )
}

BackupStatus.propTypes = {
    backupTimes: PropTypes.object,
    hover: PropTypes.bool,
    checkedIcon: PropTypes.string,
    crossIcon: PropTypes.string,
    onMouseEnter: PropTypes.func,
    onMouseLeave: PropTypes.func,
    backupState: PropTypes.object,
    automaticBackup: PropTypes.bool,
    onAutomaticBackupSelect: PropTypes.func,
    billingPeriod: PropTypes.string,
    onBillingPeriodChange: PropTypes.func,
    paymentUrl: PropTypes.string,
}

export default BackupStatus
