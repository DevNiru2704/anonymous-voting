#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VotingError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    VotingNotActive = 3,
    VotingAlreadyActive = 4,
    CommitPhaseEnded = 5,
    RevealPhaseNotStarted = 6,
    RevealPhaseEnded = 7,
    AlreadyCommitted = 8,
    AlreadyRevealed = 9,
    InvalidCommitment = 10,
    InvalidVoteOption = 11,
}

#[contracttype]
#[derive(Clone)]
pub struct VoteState {
    pub admin: Address,
    pub options: Vec<u32>,
    pub commit_end_time: u64,
    pub reveal_end_time: u64,
    pub is_active: bool,
}

const STATE_KEY: Symbol = symbol_short!("STATE");

#[contracttype]
pub enum DataKey {
    Commitment(Address),
    Reveal(Address),
    Result(u32),
}

#[contract]
pub struct AnonymousVoting;

#[contractimpl]
impl AnonymousVoting {
    pub fn init(
        env: Env,
        admin: Address,
        options: Vec<u32>,
        commit_duration: u64,
        reveal_duration: u64,
    ) -> Result<(), VotingError> {
        admin.require_auth();

        if env.storage().instance().has(&STATE_KEY) {
            return Err(VotingError::AlreadyInitialized);
        }

        let current_time = env.ledger().timestamp();
        let commit_end_time = current_time + commit_duration;
        let reveal_end_time = commit_end_time + reveal_duration;

        let state = VoteState {
            admin,
            options: options.clone(),
            commit_end_time,
            reveal_end_time,
            is_active: true,
        };

        env.storage().instance().set(&STATE_KEY, &state);

        // Initialize results for all options
        for option in options.iter() {
            env.storage().persistent().set(&DataKey::Result(option), &0u32);
        }

        env.events().publish((symbol_short!("init"),), ());

        Ok(())
    }

    /// Commit a vote phase (hash of vote + secret)
    pub fn commit(env: Env, voter: Address, commitment: BytesN<32>) -> Result<(), VotingError> {
        voter.require_auth();

        let state: VoteState = env
            .storage()
            .instance()
            .get(&STATE_KEY)
            .ok_or(VotingError::NotInitialized)?;

        if !state.is_active {
            return Err(VotingError::VotingNotActive);
        }

        let current_time = env.ledger().timestamp();
        if current_time > state.commit_end_time {
            return Err(VotingError::CommitPhaseEnded);
        }

        let commit_key = DataKey::Commitment(voter.clone());
        if env.storage().persistent().has(&commit_key) {
            return Err(VotingError::AlreadyCommitted);
        }

        env.storage().persistent().set(&commit_key, &commitment);

        env.events()
            .publish((symbol_short!("commit"), voter), commitment);

        Ok(())
    }

    pub fn reveal(
        env: Env,
        voter: Address,
        vote: u32,
        secret: BytesN<32>,
    ) -> Result<(), VotingError> {
        voter.require_auth();

        let state: VoteState = env
            .storage()
            .instance()
            .get(&STATE_KEY)
            .ok_or(VotingError::NotInitialized)?;

        if !state.is_active {
            return Err(VotingError::VotingNotActive);
        }

        let current_time = env.ledger().timestamp();
        if current_time <= state.commit_end_time {
            return Err(VotingError::RevealPhaseNotStarted);
        }

        if current_time > state.reveal_end_time {
            return Err(VotingError::RevealPhaseEnded);
        }

        if !state.options.contains(&vote) {
            return Err(VotingError::InvalidVoteOption);
        }

        let commit_key = DataKey::Commitment(voter.clone());
        let stored_commitment: BytesN<32> = env
            .storage()
            .persistent()
            .get(&commit_key)
            .ok_or(VotingError::InvalidCommitment)?;

        let reveal_key = DataKey::Reveal(voter.clone());
        if env.storage().persistent().has(&reveal_key) {
            return Err(VotingError::AlreadyRevealed);
        }

        let mut payload_bytes = soroban_sdk::Bytes::new(&env);
        payload_bytes.append(&soroban_sdk::Bytes::from_slice(&env, &vote.to_be_bytes()));
        payload_bytes.append(&secret.into());

        let computed_hash = env.crypto().sha256(&payload_bytes);

        if computed_hash.to_bytes() != stored_commitment {
             return Err(VotingError::InvalidCommitment);
        }

        env.storage().persistent().set(&reveal_key, &vote);

        // Increment tally
        let result_key = DataKey::Result(vote);
        let mut current_votes: u32 = env.storage().persistent().get(&result_key).unwrap_or(0);
        current_votes += 1;
        env.storage().persistent().set(&result_key, &current_votes);

        env.events()
            .publish((symbol_short!("reveal"), voter), vote);

        Ok(())
    }

    pub fn get_votes(env: Env, vote: u32) -> u32 {
        let result_key = DataKey::Result(vote);
        env.storage().persistent().get(&result_key).unwrap_or(0)
    }

    pub fn get_state(env: Env) -> Result<VoteState, VotingError> {
        env.storage().instance().get(&STATE_KEY).ok_or(VotingError::NotInitialized)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_init() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AnonymousVoting);
        let client = AnonymousVotingClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let mut options = Vec::new(&env);
        options.push_back(1u32);
        options.push_back(2u32);

        client.init(&admin, &options, &3600, &3600);

        let state = client.get_state();
        assert_eq!(state.options.len(), 2);
    }
}
